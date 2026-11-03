// Canvas assets: images, characters and character sheets. Uploads are free. Generated
// images (Nano Banana 2 through ComfyUI) cost credits, so they share small daily caps
// checked under a Postgres lock, like every other paid call.
import { promises as fs } from "node:fs";
import sharp from "sharp";
import type { Asset } from "@prisma/client";
import { prepareImage, type GeneratorDeps } from "./generator.js";
import { imageGraph, sheetPrompt, type SheetVariant } from "./workflows.js";

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

export type SheetVariantInput = SheetVariant | null;
export const variantOf = (a: Asset): SheetVariant | null => (a.variant as SheetVariant | null) ?? null;

export function publicAsset(a: Asset, publicPath: (key: string) => string, viewer: string | null) {
  const error = a.status === "failed" ? (viewer === a.sessionId ? a.error : "This image couldn't be made.") : null;
  const paths = pathsOf(a);
  // A video keeps [video, poster]; everything else is a list of images.
  const images = a.kind === "video" ? paths.slice(1) : paths;
  return { id: a.id, kind: a.kind, name: a.name, status: a.status, images: images.map(publicPath), prompt: a.prompt, sources: a.sources as string[], error, createdAt: a.createdAt };
}

/** Copies an asset's files, so the copy and the original can be deleted on their own. */
export async function copyFiles(deps: Pick<GeneratorDeps, "storage">, keys: string[]): Promise<string[]> {
  return Promise.all(keys.map((k) => deps.storage.copy(k)));
}

/** Saves uploaded photos as a finished asset. */
export async function uploadAsset(deps: GeneratorDeps, args: { canvasId: string | null; kind: "image" | "character"; name: string; photos: Uint8Array[]; sessionId: string; ip: string; category?: string | null }) {
  const jpegs = await Promise.all(args.photos.map((b) => prepareImage(b)));
  const paths = await Promise.all(jpegs.map((j) => deps.storage.put(j, "jpg")));
  return deps.db.asset.create({ data: { canvasId: args.canvasId, kind: args.kind, name: args.name, status: "succeeded", paths, sessionId: args.sessionId, ip: args.ip, category: args.category ?? null } });
}

/** Prompts that turn the user's words into the image they asked for. */
function promptFor(kind: "image" | "character" | "sheet", text: string, sources: Asset[], variant: SheetVariant | null): string {
  const safe = "No text, no logos, no watermark. Safe for work.";
  const hasReferences = sources.length > 0;
  if (kind === "sheet") {
    // An invented character's description (uploads have none), given once, helps the sheet hold its identity.
    const from = sources[0];
    return sheetPrompt({ identity: from?.kind === "character" ? from.prompt : null, variant });
  }
  if (kind === "character") {
    return `A full-body photo of one invented person, not resembling anyone real: ${text}. Standing, facing the camera, plain light background, even light, sharp focus.${hasReferences ? " Use the reference images for guidance." : ""} ${safe}`;
  }
  return `${text}.${hasReferences ? " Use the reference images as described." : ""} ${safe}`;
}

/**
 * Starts a generated image, character or character sheet, on a canvas or (canvasId null)
 * in the maker's Assets library. A sheet's `prompt` is the outfit or style change, if any.
 */
export async function generateAsset(
  deps: GeneratorDeps,
  args: {
    canvasId: string | null;
    kind: "image" | "character" | "sheet";
    name: string;
    prompt: string;
    sources: Asset[];
    sessionId: string;
    ip: string;
    category?: string | null;
    variant?: SheetVariant | null;
  },
) {
  const references = args.sources.flatMap(pathsOf).slice(0, MAX_IMAGE_REFERENCES);
  const variant = args.kind === "sheet" && (args.variant?.outfit || args.variant?.style) ? args.variant! : null;
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
      data: {
        canvasId: args.canvasId,
        kind: args.kind,
        name: args.name,
        prompt: args.kind === "sheet" ? (variant?.outfit ?? variant?.style ?? null) : args.prompt,
        variant: variant ?? undefined,
        sources: args.sources.map((s) => s.id),
        generated: true,
        category: args.category ?? null,
        sessionId: args.sessionId,
        ip: args.ip,
      },
    });
  });
  if (args.sources.length) await deps.db.asset.updateMany({ where: { id: { in: args.sources.map((s) => s.id) } }, data: { usedAt: new Date() } });
  void runAsset(deps, row.id, promptFor(args.kind, args.prompt, args.sources, variant), references, args.kind).catch((err) => deps.log.error({ id: row.id, err }, "image crashed"));
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
    // Sheets are the reference every later video leans on: worth a sharper, more careful render.
    const sheet = kind === "sheet";
    const out = await provider.runGraph({
      graph: imageGraph({ prompt, ratio, references: uploads.length, resolution: sheet ? "2K" : "1K", thinking: sheet ? "HIGH" : "MINIMAL" }),
      uploads,
      outputNode: "out",
      kind: "image",
      seconds: 0,
      onJobCreated: async (jobId) => { await db.asset.update({ where: { id }, data: { comfyJobId: jobId } }); },
      signal: AbortSignal.timeout(cfg.JOB_TIMEOUT_MINUTES * 60_000),
    });
    // prepareImage caps the long side; a 2K sheet keeps its detail.
    const key = await storage.put(sheet ? await sharp(out.video).rotate().resize(2048, 2048, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer() : await prepareImage(out.video), "jpg");
    await db.asset.update({ where: { id }, data: { status: "succeeded", paths: [key] } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const apiKey = cfg.COMFY_API_KEY;
    log.error({ id, err: message }, "image failed");
    await db.asset.update({ where: { id }, data: { status: "failed", error: (apiKey ? message.replaceAll(apiKey, "[redacted]") : message).slice(0, 300) } }).catch(() => {});
  }
}
