// Orchestrates one generation: DB row -> provider call -> store video -> DB row.
// Runs in-process and async (fire-and-forget from the route). For a hackathon
// scale this is fine; a queue (BullMQ etc.) would be the next step.
import type { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import type { GenerateOutput, VideoProvider } from "./comfy.js";
import type { Storage } from "./storage.js";
import type { Config } from "../config.js";
import { buildEffectPrompt, getEffect, type ReferenceRole } from "../effects.js";
import { checkLimits } from "./limits.js";

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

// Any fixed number: it names the Postgres lock that guards "check caps, then insert".
const CAP_LOCK_ID = 727_001;

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

  // Checking the caps and inserting the row must be one atomic step. Otherwise parallel
  // requests all see "under the cap" and all get through, each costing real money. The
  // lock is released at commit and works across instances, because it lives in Postgres.
  let row;
  try {
    row = await deps.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${CAP_LOCK_ID})::text`;
        const limit = await checkLimits(tx, deps.cfg, { sessionId: args.sessionId, ip: args.ip });
        if (!limit.ok) throw new LimitExceededError(limit.reason, limit.message);
        return tx.generation.create({
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
      },
      { maxWait: 15_000, timeout: 15_000 },
    );
  } catch (err) {
    await Promise.all(paths.map((p) => deps.storage.remove(p).catch(() => {})));
    throw err;
  }
  // Fire and forget; status is polled by the client.
  void runGeneration(deps, row.id, jpegs, effect.seconds).catch((err) => deps.log.error({ id: row.id, err }, "generation crashed"));
  return row;
}

/** Throttled progress writer: the DB gets at most one update per second. */
function progressWriter(db: PrismaClient, id: string) {
  let lastWrite = 0;
  return (percent: number) => {
    const now = Date.now();
    if (now - lastWrite < 1000) return;
    lastWrite = now;
    void db.generation.update({ where: { id }, data: { progress: percent } }).catch(() => {});
  };
}

/** Runs a provider call, stores the video, and records the outcome on the row. */
async function settle(deps: GeneratorDeps, id: string, call: () => Promise<GenerateOutput>): Promise<void> {
  const { db, storage, log } = deps;
  try {
    const out = await call();
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
  const finished = Promise.all(
    rows.flatMap((row) => {
      const jobId = row.comfyJobId;
      if (!jobId) return [];
      log.info({ id: row.id, jobId }, "resuming interrupted generation");
      return [
        settle(deps, row.id, () =>
          provider.resume({ jobId, onProgress: progressWriter(db, row.id), signal: AbortSignal.timeout(cfg.JOB_TIMEOUT_MINUTES * 60_000) }),
        ),
      ];
    }),
  ).then(() => {});
  return { finished };
}
