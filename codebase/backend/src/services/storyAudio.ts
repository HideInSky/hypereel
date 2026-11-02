// Sound for stories: AI music (Sonilo) and AI sound effects (ElevenLabs) through
// ComfyUI, a clip's own audio, and the bundled sound library. Sound layers are what
// the user places on the timeline; they are mixed only when the story is exported.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AudioClip, Generation } from "@prisma/client";
import { z } from "zod";
import type { GeneratorDeps } from "./generator.js";
import { extractAudio, probe } from "./media.js";
import { audioGraph } from "./workflows.js";

const AUDIO_OUTPUT_NODE = "out";
// Each sound costs a few cents, but they still need a ceiling.
const SOUNDS_PER_SESSION_PER_DAY = 15;
const SOUNDS_PER_IP_PER_DAY = 30;
const SOUNDS_PER_DAY = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const SOUND_LOCK_ID = 727_002;

export const AudioRequestSchema = z.object({
  kind: z.enum(["music", "sfx"]),
  prompt: z.string().transform((t) => t.replace(/\s+/g, " ").trim()).pipe(z.string().min(2, "Describe the sound.").max(300)),
  seconds: z.coerce.number().min(1).max(60),
}).refine((r) => r.kind === "music" || r.seconds <= 30, { message: "Sound effects can be 30 seconds at most.", path: ["seconds"] });

export const LayerSchema = z.object({
  id: z.string().min(1).max(40),
  source: z.union([z.object({ clipId: z.string().min(1).max(40) }), z.object({ sound: z.string().min(1).max(60) })]),
  label: z.string().transform((t) => t.replace(/\s+/g, " ").trim()).pipe(z.string().max(60)),
  start: z.number().min(0).max(600),
  length: z.number().min(0.1).max(600).nullable(),
  volume: z.number().min(0).max(2),
  loop: z.boolean(),
});
export const LayersSchema = z.array(LayerSchema).max(12, "A story can have 12 sound layers at most.");
export type Layer = z.infer<typeof LayerSchema>;

export class SoundLimitError extends Error {}

export function publicClip(c: AudioClip, publicPath: (key: string) => string, viewer: string | null) {
  // Provider errors can hold internal detail, so only the owner sees them.
  const error = c.status === "failed" ? (viewer === c.sessionId ? c.error : "This sound couldn't be made.") : null;
  return { id: c.id, kind: c.kind, label: c.label, status: c.status, url: c.path ? publicPath(c.path) : null, seconds: c.seconds, shotId: c.shotId, error };
}

const labelFor = (kind: "music" | "sfx", prompt: string) => `${kind === "music" ? "Music" : "Sound"}: ${prompt.length > 40 ? `${prompt.slice(0, 39)}…` : prompt}`;

/** Starts an AI sound. Counts against its own small daily caps. */
export async function createSound(deps: GeneratorDeps, args: { kind: "music" | "sfx"; prompt: string; seconds: number; sessionId: string; ip: string }) {
  const since = new Date(Date.now() - DAY_MS);
  // Count and insert under one lock, so parallel requests can't all slip under the caps.
  const row = await deps.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${SOUND_LOCK_ID})::text`;
    const paid = { kind: { not: "original" }, createdAt: { gte: since } };
    const [mine, fromIp, all] = await Promise.all([
      tx.audioClip.count({ where: { sessionId: args.sessionId, ...paid } }),
      tx.audioClip.count({ where: { ip: args.ip, ...paid } }),
      tx.audioClip.count({ where: paid }),
    ]);
    if (mine >= SOUNDS_PER_SESSION_PER_DAY || fromIp >= SOUNDS_PER_IP_PER_DAY || all >= SOUNDS_PER_DAY) {
      throw new SoundLimitError("That's the limit for new sounds today. Library sounds and a clip's own sound are still free to use.");
    }
    return tx.audioClip.create({
      data: { kind: args.kind, prompt: args.prompt, label: labelFor(args.kind, args.prompt), seconds: args.seconds, sessionId: args.sessionId, ip: args.ip },
    });
  });
  void runSound(deps, row.id).catch((err) => deps.log.error({ id: row.id, err }, "sound crashed"));
  return row;
}

async function runSound(deps: GeneratorDeps, id: string) {
  const { db, provider, storage, cfg, log } = deps;
  const row = await db.audioClip.update({ where: { id }, data: { status: "running" } });
  try {
    const kind = row.kind as "music" | "sfx";
    const out = await provider.runGraph({
      graph: audioGraph({ kind, prompt: row.prompt ?? "", seconds: row.seconds }),
      uploads: [],
      outputNode: AUDIO_OUTPUT_NODE,
      kind: "audio",
      seconds: row.seconds,
      onJobCreated: async (jobId) => { await db.audioClip.update({ where: { id }, data: { comfyJobId: jobId } }); },
      signal: AbortSignal.timeout(cfg.JOB_TIMEOUT_MINUTES * 60_000),
    });
    const key = await storage.put(out.video, "mp3");
    const seconds = await probe(storage.absolutePath(key)).then((i) => i.seconds).catch(() => row.seconds);
    await db.audioClip.update({ where: { id }, data: { status: "succeeded", path: key, seconds } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const key = cfg.COMFY_API_KEY;
    log.error({ id, err: message }, "sound failed");
    await db.audioClip.update({ where: { id }, data: { status: "failed", error: (key ? message.replaceAll(key, "[redacted]") : message).slice(0, 300) } }).catch(() => {});
  }
}

/** A clip's own sound as a reusable layer source. Free: no model involved. */
export async function originalSound(deps: GeneratorDeps, shot: Generation, label: string, owner: { sessionId: string; ip: string }) {
  if (!shot.videoPath) return null;
  // Asking twice for the same clip's sound reuses the first copy.
  const existing = await deps.db.audioClip.findFirst({ where: { kind: "original", shotId: shot.id, sessionId: owner.sessionId, status: "succeeded" } });
  if (existing) return existing;
  const file = deps.storage.absolutePath(shot.videoPath);
  const bytes = await extractAudio(file);
  if (!bytes) return null;
  const key = await deps.storage.put(bytes, "m4a");
  const seconds = (await probe(deps.storage.absolutePath(key))).seconds;
  return deps.db.audioClip.create({ data: { kind: "original", shotId: shot.id, label, seconds, status: "succeeded", path: key, ...owner } });
}

/**
 * When a shot is inserted or removed, a clip's original sound should stay under that
 * clip. Layers made from a clip that sits after the change move by `delta` seconds.
 * Other layers (music, effects, library sounds) keep their place on the timeline.
 */
export function shiftOriginalLayers(layers: Layer[], clipShot: Map<string, string>, movedShots: Set<string>, delta: number): Layer[] {
  return layers.map((l) => {
    const shot = "clipId" in l.source ? clipShot.get(l.source.clipId) : undefined;
    return shot && movedShots.has(shot) ? { ...l, start: Math.min(600, Math.max(0, Math.round((l.start + delta) * 100) / 100)) } : l;
  });
}

export interface LibrarySound { id: string; label: string; file: string; seconds: number | null; license: string; credit: string; source?: string }

const here = path.dirname(fileURLToPath(import.meta.url));

/** The bundled sounds. In production they ship inside the built frontend. */
export function soundLibrary(): { dir: string; sounds: LibrarySound[] } {
  const candidates = [path.resolve(here, "../../../frontend/dist/sounds"), path.resolve(here, "../../../frontend/public/sounds")];
  const dir = candidates.find((d) => existsSync(path.join(d, "library.json")));
  if (!dir) return { dir: "", sounds: [] };
  try {
    const list = JSON.parse(readFileSync(path.join(dir, "library.json"), "utf8")) as LibrarySound[];
    // Only list files that are really there, with names that can't escape the folder.
    return { dir, sounds: list.filter((s) => /^[\w.-]+$/.test(s.file) && existsSync(path.join(dir, s.file))) };
  } catch {
    return { dir, sounds: [] };
  }
}
