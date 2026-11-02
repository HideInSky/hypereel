// Canvas assets: images, characters and character sheets. Uploads are free. Generated
// images (Nano Banana 2 through ComfyUI) cost credits, so they share small daily caps
// checked under a Postgres lock, like every other paid call.
import { promises as fs } from "node:fs";
import sharp from "sharp";
import type { Asset } from "@prisma/client";
import { prepareImage, type GeneratorDeps } from "./generator.js";
import { imageGraph, SHEET_PROMPT } from "./workflows.js";

const IMAGES_PER_SESSION_PER_DAY = 20;
const IMAGES_PER_IP_PER_DAY = 40;
const IMAGES_PER_DAY = 150;
const IMAGE_LOCK_ID = 727_003;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Most reference images we send to Nano Banana at once. */
export const MAX_IMAGE_REFERENCES = 6;

export class AssetLimitError extends Error {}
export class AssetError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export const pathsOf = (a: Asset) => a.paths as string[];

export function publicAsset(a: Asset, publicPath: (key: string) => string, viewer: string | null) {
  const error = a.status === "failed" ? (viewer === a.sessionId ? a.error : "This image couldn't be made.") : null;
  return { id: a.id, kind: a.kind, name: a.name, status: a.status, images: pathsOf(a).map(publicPath), prompt: a.prompt, sources: a.sources as string[], error, createdAt: a.createdAt };
}

/** Saves uploaded photos as a finished asset. */
export async function uploadAsset(deps: GeneratorDeps, args: { canvasId: string; kind: "image" | "character"; name: string; photos: Uint8Array[]; sessionId: string; ip: string }) {
  const jpegs = await Promise.all(args.photos.map((b) => prepareImage(b)));
  const paths = await Promise.all(jpegs.map((j) => deps.storage.put(j, "jpg")));
  return deps.db.asset.create({ data: { canvasId: args.canvasId, kind: args.kind, name: args.name, status: "succeeded", paths, sessionId: args.sessionId, ip: args.ip } });
}

/** Prompts that turn the user's words into the image they asked for. */
function promptFor(kind: "image" | "character" | "sheet", text: string, hasReferences: boolean): string {
  const safe = "No text, no logos, no watermark. Safe for work.";
  if (kind === "sheet") return SHEET_PROMPT;
  if (kind === "character") {
    return `A full-body photo of one invented person, not resembling anyone real: ${text}. Standing, facing the camera, plain light background, even light, sharp focus.${hasReferences ? " Use the reference images for guidance." : ""} ${safe}`;
  }
  return `${text}.${hasReferences ? " Use the reference images as described." : ""} ${safe}`;
}

/** Starts a generated image, character or character sheet. */
export async function generateAsset(
  deps: GeneratorDeps,
  args: { canvasId: string; kind: "image" | "character" | "sheet"; name: string; prompt: string; sources: Asset[]; sessionId: string; ip: string },
) {
  const references = args.sources.flatMap(pathsOf).slice(0, MAX_IMAGE_REFERENCES);
  const since = new Date(Date.now() - DAY_MS);
  const row = await deps.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${IMAGE_LOCK_ID})::text`;
    const paid = { generated: true, createdAt: { gte: since } };
    const [mine, fromIp, all] = await Promise.all([
      tx.asset.count({ where: { sessionId: args.sessionId, ...paid } }),
      tx.asset.count({ where: { ip: args.ip, ...paid } }),
      tx.asset.count({ where: paid }),
    ]);
    if (mine >= IMAGES_PER_SESSION_PER_DAY || fromIp >= IMAGES_PER_IP_PER_DAY || all >= IMAGES_PER_DAY) {
      throw new AssetLimitError("That's the limit for new images today. Uploading your own photos is still free.");
    }
    return tx.asset.create({
      data: { canvasId: args.canvasId, kind: args.kind, name: args.name, prompt: args.kind === "sheet" ? null : args.prompt, sources: args.sources.map((s) => s.id), generated: true, sessionId: args.sessionId, ip: args.ip },
    });
  });
  void runAsset(deps, row.id, promptFor(args.kind, args.prompt, references.length > 0), references, args.kind).catch((err) => deps.log.error({ id: row.id, err }, "image crashed"));
  return row;
}

async function runAsset(deps: GeneratorDeps, id: string, prompt: string, references: string[], kind: "image" | "character" | "sheet") {
  const { db, provider, storage, cfg, log } = deps;
  await db.asset.update({ where: { id }, data: { status: "running" } });
  try {
    // One shared size, so the batch node doesn't stretch any of them.
    const uploads = await Promise.all(
      references.map(async (key, i): Promise<[string, string, Uint8Array, string]> => {
        const bytes = await sharp(await fs.readFile(storage.absolutePath(key))).resize(1024, 1024, { fit: "contain", background: "#d9dbe0" }).png().toBuffer();
        return [`img_${i + 1}`, "image", new Uint8Array(bytes), `reference_${i + 1}.png`];
      }),
    );
    const ratio = kind === "sheet" ? "16:9" : kind === "character" ? "3:4" : "auto";
    const out = await provider.runGraph({
      graph: imageGraph({ prompt, ratio, references: uploads.length }),
      uploads,
      outputNode: "out",
      kind: "image",
      seconds: 0,
      onJobCreated: async (jobId) => { await db.asset.update({ where: { id }, data: { comfyJobId: jobId } }); },
      signal: AbortSignal.timeout(cfg.JOB_TIMEOUT_MINUTES * 60_000),
    });
    const key = await storage.put(await prepareImage(out.video), "jpg");
    await db.asset.update({ where: { id }, data: { status: "succeeded", paths: [key] } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const apiKey = cfg.COMFY_API_KEY;
    log.error({ id, err: message }, "image failed");
    await db.asset.update({ where: { id }, data: { status: "failed", error: (apiKey ? message.replaceAll(apiKey, "[redacted]") : message).slice(0, 300) } }).catch(() => {});
  }
}
