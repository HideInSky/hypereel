// Orchestrates one generation: DB row -> provider call -> store video -> DB row.
// Runs in-process and async (fire-and-forget from the route). For a hackathon
// scale this is fine; a queue (BullMQ etc.) would be the next step.
import type { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import type { VideoProvider } from "./comfy.js";
import type { Storage } from "./storage.js";
import type { Config } from "../config.js";
import { buildEffectPrompt, getEffect, type ReferenceRole } from "../effects.js";

export interface GeneratorDeps {
  db: PrismaClient;
  provider: VideoProvider;
  storage: Storage;
  cfg: Config;
  log: { info: (o: object, m?: string) => void; error: (o: object, m?: string) => void };
}

export interface UploadedReference {
  role: ReferenceRole;
  bytes: Uint8Array;
}

/** Normalise an upload: strip EXIF, cap size, always JPEG. */
export async function prepareImage(bytes: Uint8Array): Promise<Uint8Array> {
  const out = await sharp(bytes, { failOn: "error" })
    .rotate() // applies EXIF orientation
    .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  return new Uint8Array(out);
}

export async function createGeneration(
  deps: GeneratorDeps,
  args: {
    effect: string;
    references: UploadedReference[]; // already ordered: characters, locations, products
    userPrompt?: string;
    resolution: string;
    aspectRatio: string;
    sessionId: string;
    ip: string;
  },
) {
  const effect = getEffect(args.effect);
  if (!effect) throw new Error(`Unknown effect: ${args.effect}`);

  const jpegs = await Promise.all(args.references.map((r) => prepareImage(r.bytes)));
  const paths = await Promise.all(jpegs.map((j) => deps.storage.put(j, "jpg")));
  const prompt = buildEffectPrompt(args.effect, args.references, args.userPrompt);

  const row = await deps.db.generation.create({
    data: {
      genre: args.effect, // column keeps its old name; it now holds the effect id
      caption: args.userPrompt || null,
      prompt,
      model: deps.provider.name,
      inputPath: paths[0]!,
      posterPath: paths[0]!, // the character photo doubles as the poster until the video exists
      references: args.references.map((r, i) => ({ role: r.role, path: paths[i]! })),
      resolution: args.resolution,
      aspectRatio: args.aspectRatio,
      sessionId: args.sessionId,
      ip: args.ip,
    },
  });
  // Fire and forget; status is polled by the client.
  void runGeneration(deps, row.id, jpegs, effect.seconds).catch((err) => deps.log.error({ id: row.id, err }, "generation crashed"));
  return row;
}

export async function runGeneration(deps: GeneratorDeps, id: string, references: Uint8Array[], seconds: number): Promise<void> {
  const { db, provider, storage, log } = deps;
  const row = await db.generation.findUniqueOrThrow({ where: { id } });
  await db.generation.update({ where: { id }, data: { status: "running", progress: 3 } });

  let lastWrite = 0;
  const onProgress = (percent: number) => {
    const now = Date.now();
    if (now - lastWrite < 1000) return; // don't hammer the DB
    lastWrite = now;
    void db.generation.update({ where: { id }, data: { progress: percent } }).catch(() => {});
  };

  try {
    const out = await provider.generate({
      references,
      prompt: row.prompt,
      seconds,
      resolution: row.resolution ?? "480P",
      aspectRatio: row.aspectRatio ?? "9:16",
      onProgress,
    });
    const videoPath = await storage.put(out.video, out.mime.includes("webm") ? "webm" : "mp4");
    await db.generation.update({
      where: { id },
      data: { status: "succeeded", progress: 100, videoPath, comfyJobId: out.jobId ?? null, model: out.model },
    });
    log.info({ id, jobId: out.jobId, model: out.model }, "generation succeeded");
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    const reason = cause?.code ?? cause?.message;
    const message = (err instanceof Error ? err.message : String(err)) + (reason ? ` (${reason})` : "");
    log.error({ id, err: message }, "generation failed");
    // The row may have been deleted meanwhile (tests, admin cleanup): never crash the process over it.
    await db.generation
      .update({ where: { id }, data: { status: "failed", error: message.slice(0, 500) } })
      .catch(() => {});
  }
}
