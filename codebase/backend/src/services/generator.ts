// Orchestrates one generation: DB row -> provider call -> store video -> DB row.
// Runs in-process and async (fire-and-forget from the route). For a hackathon
// scale this is fine; a queue (BullMQ etc.) would be the next step.
import type { Prisma, PrismaClient } from "@prisma/client";
import sharp from "sharp";
import type { GenerateOutput, VideoProvider } from "./comfy.js";
import type { Storage } from "./storage.js";
import type { Config } from "../config.js";
import { buildPromptFor, getEffect, type Effect, type ReferenceRole } from "../effects.js";
import { checkLimits } from "./limits.js";
import { toPlayback } from "./transcode.js";

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

/** Thrown when a spending cap is reached at the moment of reserving a clip. */
export class LimitExceededError extends Error {
  constructor(readonly reason: "session" | "ip" | "global", message: string) {
    super(message);
  }
}

/** The SaveVideo node in story graphs (services/workflows.ts). */
export const SHOT_OUTPUT_NODE = "out";

// Any fixed number: it names the Postgres lock that guards "check caps, then insert".
const CAP_LOCK_ID = 727_001;

export async function createGeneration(
  deps: GeneratorDeps,
  args: {
    effect: Effect;
    references: UploadedReference[]; // already ordered: characters, locations, products
    userPrompt?: string;
    resolution: string;
    aspectRatio: string;
    sessionId: string;
    ip: string;
    /** Set when made on a canvas: the canvas, and which asset each reference came from. */
    canvasId?: string;
    assetIds?: string[];
  },
) {
  const { effect } = args;

  const jpegs = await Promise.all(args.references.map((r) => prepareImage(r.bytes)));
  const paths = await Promise.all(jpegs.map((j) => deps.storage.put(j, "jpg")));
  const prompt = buildPromptFor(effect, args.references, args.userPrompt);

  const row = await reserveGeneration(
    deps,
    {
      genre: effect.id, // column keeps its old name; it now holds the effect id
      effectName: getEffect(effect.id) ? null : effect.label,
      caption: args.userPrompt || null,
      prompt,
      model: deps.provider.name,
      inputPath: paths[0]!,
      posterPath: paths[0]!, // the character photo doubles as the poster until the video exists
      references: args.references.map((r, i) => ({ role: r.role, path: paths[i]!, ...(args.assetIds?.[i] ? { assetId: args.assetIds[i] } : {}) })),
      canvasId: args.canvasId ?? null,
      resolution: args.resolution,
      aspectRatio: args.aspectRatio,
      sessionId: args.sessionId,
      ip: args.ip,
    },
    paths,
  );
  // Fire and forget; status is polled by the client.
  void runGeneration(deps, row.id, jpegs, effect.seconds).catch((err) => deps.log.error({ id: row.id, err }, "generation crashed"));
  return row;
}

/**
 * Checks the caps and inserts the row as one atomic step. Otherwise parallel requests
 * all see "under the cap" and all get through, each costing real money. The lock is
 * released at commit and works across instances, because it lives in Postgres.
 * On failure, the given stored files are removed. `afterCreate` runs in the same
 * transaction, for callers that must link the row somewhere atomically.
 */
export async function reserveGeneration(
  deps: Pick<GeneratorDeps, "db" | "cfg" | "storage">,
  data: Prisma.GenerationUncheckedCreateInput,
  ownedPaths: string[],
  afterCreate?: (tx: Prisma.TransactionClient, id: string) => Promise<void>,
) {
  try {
    return await deps.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${CAP_LOCK_ID})::text`;
        const limit = await checkLimits(tx, deps.cfg, { sessionId: data.sessionId, ip: data.ip });
        if (!limit.ok) throw new LimitExceededError(limit.reason, limit.message);
        const row = await tx.generation.create({ data });
        await afterCreate?.(tx, row.id);
        return row;
      },
      { maxWait: 15_000, timeout: 15_000 },
    );
  } catch (err) {
    await Promise.all(ownedPaths.map((p) => deps.storage.remove(p).catch(() => {})));
    throw err;
  }
}

/** Throttled progress writer: the DB gets at most one update per second. */
export function progressWriter(db: PrismaClient, id: string) {
  let lastWrite = 0;
  return (percent: number) => {
    const now = Date.now();
    if (now - lastWrite < 1000) return;
    lastWrite = now;
    void db.generation.update({ where: { id }, data: { progress: percent } }).catch(() => {});
  };
}

/** Runs a provider call, stores the video, and records the outcome on the row. */
export async function settle(deps: GeneratorDeps, id: string, call: () => Promise<GenerateOutput>): Promise<void> {
  const { db, storage, log } = deps;
  try {
    const out = await call();
    // Smoother playback, but never worth losing a paid clip: fall back to the original.
    const video = await toPlayback(out.video).catch((err) => {
      log.error({ id, err: String(err) }, "could not compress clip, keeping the original");
      return out.video;
    });
    const videoPath = await storage.put(video, "mp4");
    await db.generation.update({
      where: { id },
      data: { status: "succeeded", progress: 100, videoPath, comfyJobId: out.jobId ?? null, model: out.model },
    });
    log.info({ id, jobId: out.jobId, model: out.model }, "generation succeeded");
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    const reason = cause?.code ?? cause?.message;
    const raw = (err instanceof Error ? err.message : String(err)) + (reason ? ` (${reason})` : "");
    // This text reaches the logs and the clip's owner, so it must never carry the API key.
    const key = deps.cfg.COMFY_API_KEY;
    const message = key ? raw.replaceAll(key, "[redacted]") : raw;
    log.error({ id, err: message }, "generation failed");
    // The row may have been deleted meanwhile (tests, admin cleanup): never crash the process over it.
    await db.generation
      .update({ where: { id }, data: { status: "failed", error: message.slice(0, 500) } })
      .catch(() => {});
  }
}

export async function runGeneration(deps: GeneratorDeps, id: string, references: Uint8Array[], seconds: number): Promise<void> {
  const { db, provider, cfg } = deps;
  const row = await db.generation.findUniqueOrThrow({ where: { id } });
  await db.generation.update({ where: { id }, data: { status: "running", progress: 3 } });
  await settle(deps, id, () =>
    provider.generate({
      references,
      prompt: row.prompt,
      seconds,
      resolution: row.resolution ?? "480P",
      aspectRatio: row.aspectRatio ?? "9:16",
      onProgress: progressWriter(db, id),
      // Saved right away: this id is what lets the job survive a restart.
      onJobCreated: async (jobId) => {
        await db.generation.update({ where: { id }, data: { comfyJobId: jobId } });
      },
      signal: AbortSignal.timeout(cfg.JOB_TIMEOUT_MINUTES * 60_000),
    }),
  );
}

/**
 * Call once at startup. Renders run inside this process, so a restart or redeploy
 * interrupts them. Jobs already on Comfy keep running there (and are paid for), so
 * re-attach and collect the result. Rows that never reached Comfy can't be recovered.
 * This assumes one instance. With several, it needs a lease so that they don't all
 * grab the same rows. Call it BEFORE accepting traffic, or a brand-new row could be
 * mistaken for an interrupted one. Resolves once the rows are triaged; `finished`
 * resolves when the re-attached jobs are done.
 */
export async function resumeInterrupted(deps: GeneratorDeps): Promise<{ finished: Promise<void> }> {
  const { db, provider, cfg, log } = deps;
  const rows = await db.generation.findMany({ where: { status: { in: ["queued", "running"] } } });
  const lost = rows.filter((r) => !r.comfyJobId).map((r) => r.id);
  if (lost.length > 0) {
    await db.generation.updateMany({
      where: { id: { in: lost } },
      data: { status: "failed", error: "The server restarted before this render started. Please try again." },
    });
  }
  // Sound and image jobs cost cents and exports cost nothing, so those are simply marked failed.
  await db.asset.updateMany({ where: { status: { in: ["queued", "running"] } }, data: { status: "failed", error: "The server restarted. Please try again." } });
  await db.audioClip.updateMany({ where: { status: { in: ["queued", "running"] } }, data: { status: "failed", error: "The server restarted. Please try again." } });
  await db.sequence.updateMany({ where: { exportStatus: "rendering" }, data: { exportStatus: "failed", exportError: "The server restarted. Please export again." } });
  const finished = Promise.all(
    rows.flatMap((row) => {
      const jobId = row.comfyJobId;
      if (!jobId) return [];
      log.info({ id: row.id, jobId }, "resuming interrupted generation");
      return [
        settle(deps, row.id, () =>
          provider.resume({
            jobId,
            outputNode: row.shotMode ? SHOT_OUTPUT_NODE : undefined,
            onProgress: progressWriter(db, row.id),
            signal: AbortSignal.timeout(cfg.JOB_TIMEOUT_MINUTES * 60_000),
          }),
        ),
      ];
    }),
  ).then(() => {});
  return { finished };
}
