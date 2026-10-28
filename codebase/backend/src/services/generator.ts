// Orchestrates one generation: DB row -> provider call -> store video -> DB row.
// Runs in-process and async (fire-and-forget from the route). For a hackathon
// scale this is fine; a queue (BullMQ etc.) would be the next step.
import type { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import type { VideoProvider } from "./comfy.js";
import type { Storage } from "./storage.js";
import type { Config } from "../config.js";
import { buildPrompt } from "../prompts.js";

export interface GeneratorDeps {
  db: PrismaClient;
  provider: VideoProvider;
  storage: Storage;
  cfg: Config;
  log: { info: (o: object, m?: string) => void; error: (o: object, m?: string) => void };
}

/** Normalise the upload: strip EXIF, cap size, always JPEG. Also makes the poster. */
export async function prepareImage(bytes: Uint8Array): Promise<{ jpeg: Uint8Array; width: number; height: number }> {
  const img = sharp(bytes, { failOn: "error" }).rotate(); // rotate() applies EXIF orientation
  const resized = await img.resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer({ resolveWithObject: true });
  return { jpeg: new Uint8Array(resized.data), width: resized.info.width, height: resized.info.height };
}

export async function createGeneration(
  deps: GeneratorDeps,
  args: { imageBytes: Uint8Array; genre: string; caption?: string; sessionId: string; ip: string },
) {
  const { jpeg } = await prepareImage(args.imageBytes);
  const inputPath = await deps.storage.put(jpeg, "jpg");
  const prompt = buildPrompt(args.genre, args.caption);
  const row = await deps.db.generation.create({
    data: {
      genre: args.genre,
      caption: args.caption || null,
      prompt,
      model: deps.provider.name,
      inputPath,
      posterPath: inputPath, // the photo doubles as the poster until the video exists
      sessionId: args.sessionId,
      ip: args.ip,
    },
  });
  // Fire and forget; status is polled by the client.
  void runGeneration(deps, row.id, jpeg).catch((err) => deps.log.error({ id: row.id, err }, "generation crashed"));
  return row;
}

export async function runGeneration(deps: GeneratorDeps, id: string, jpeg: Uint8Array): Promise<void> {
  const { db, provider, storage, cfg, log } = deps;
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
      imageBytes: jpeg,
      imageExt: "jpg",
      prompt: row.prompt,
      seconds: cfg.VIDEO_SECONDS,
      resolution: cfg.VIDEO_RESOLUTION,
      onProgress,
    });
    const videoPath = await storage.put(out.video, out.mime.includes("webm") ? "webm" : "mp4");
    await db.generation.update({
      where: { id },
      data: { status: "succeeded", progress: 100, videoPath, comfyJobId: out.jobId ?? null, model: out.model },
    });
    log.info({ id, jobId: out.jobId, model: out.model }, "generation succeeded");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ id, err: message }, "generation failed");
    // The row may have been deleted meanwhile (tests, admin cleanup): never crash the process over it.
    await db.generation
      .update({ where: { id }, data: { status: "failed", error: message.slice(0, 500) } })
      .catch(() => {});
  }
}
