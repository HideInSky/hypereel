// Shots added before or after a clip in a story. Continue joins seamlessly through a
// shared frame. Restage copies the neighbouring clip's moves into a new scene, using it
// as H3's "Video 1". Each shot is an ordinary Generation row, so the spending caps,
// restart recovery and history all apply to it unchanged.
import { promises as fs } from "node:fs";
import type { Generation, Prisma } from "@prisma/client";
import { z } from "zod";
import { prepareImage, progressWriter, reserveGeneration, settle, SHOT_OUTPUT_NODE, type GeneratorDeps } from "./generator.js";
import { closestRatio, frame, probeCached } from "./media.js";
import { beforeGraph, continueGraph, restageGraph } from "./workflows.js";
import { DETAIL_MAX, promptText } from "../textLimits.js";

const oneLine = (max: number) => z.string().transform((t) => t.replace(/\s+/g, " ").trim()).pipe(z.string().max(max)).default("");

export const ShotRequestSchema = z.object({
  anchorId: z.string().min(1).max(40),
  side: z.enum(["before", "after"]),
  mode: z.enum(["continue", "restage"]),
  action: promptText().default(""),
  place: oneLine(DETAIL_MAX),
  style: oneLine(DETAIL_MAX),
  light: oneLine(DETAIL_MAX),
  keepMoves: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  seconds: z.coerce.number().pipe(z.union([z.literal(5), z.literal(6), z.literal(8)])).default(5),
});
export type ShotRequest = z.infer<typeof ShotRequestSchema>;

/** Most images H3's reference node takes. */
const MAX_IMAGES = 9;
export const MAX_NEW_CHARACTERS = 4;

type Input = { role: "character" | "location" | "product" | "first_frame" | "last_frame" | "video"; path: string; shared?: boolean };

/** What a story shot stores in Generation.references. */
export interface ShotSettings {
  kind: "shot";
  side: "before" | "after";
  seconds: number;
  width: number;
  height: number;
  ratio: string;
  scenePrompt?: string;
  inputs: Input[];
}

const SAFE = "Photorealistic unless a style is given, cinematic, safe for work. No on-screen text, no readable signs, no subtitles, no logos, no watermark.";
const KEEP_PERSON = "Keep the same person, face, hair and outfit throughout.";

const scene = (r: ShotRequest) =>
  [r.place && `The setting is ${r.place}.`, r.style && `Visual style: ${r.style}.`, r.light && `Lighting: ${r.light}.`].filter(Boolean).join(" ");

/** Describes images by position, the way H3 reads them ("Image 1 and Image 2 show..."). */
function describe(numbers: number[], text: string): string {
  if (numbers.length === 0) return "";
  const names = numbers.map((n) => `Image ${n}`);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${list} ${names.length === 1 ? "shows" : "show"} ${text}`;
}

export function shotPrompts(r: ShotRequest, roles: Input["role"][]): { prompt: string; scenePrompt?: string } {
  const action = r.action ? `${r.action.replace(/[.!?]$/, "")}.` : "";
  if (r.mode === "restage") {
    const at = (role: Input["role"]) => roles.flatMap((x, i) => (x === role ? [i + 1] : []));
    const lines = [
      describe(at("character"), "the people in this shot. Keep their faces, hair and outfits exactly the same."),
      describe(at("location"), "the original location, for reference only."),
      describe(at("product"), "the product items. Keep their exact shape, color and details."),
      r.keepMoves
        ? "Video 1 shows the moves. Perform exactly the same moves as in Video 1, with the same timing, the same order and the same framing."
        : "Video 1 shows the previous shot, for continuity of the people and their energy.",
      action,
      scene(r) || "Move the action to a new, fitting setting.",
      SAFE,
    ];
    return { prompt: lines.filter(Boolean).join(" ") };
  }
  if (r.side === "after") {
    const lines = [
      "Continue seamlessly from the first frame, as the next moment of the same shot.",
      action || "The action carries on naturally.",
      r.place ? `The scene gradually and smoothly changes into ${r.place}.` : "",
      r.style ? `The look gradually shifts to ${r.style}.` : "",
      r.light ? `The lighting gradually becomes ${r.light}.` : "",
      KEEP_PERSON,
      SAFE,
    ];
    return { prompt: lines.filter(Boolean).join(" ") };
  }
  const where = r.place || "a different place that suits them";
  const lines = [
    action || "The same person moves naturally, leading into the next shot.",
    `It starts in ${where}${r.style ? `, ${r.style}` : ""}${r.light ? `, ${r.light}` : ""}, and the scene gradually and smoothly transforms until it ends exactly on the last frame.`,
    KEEP_PERSON,
    SAFE,
  ];
  const scenePrompt = `The same person with the same face, hair and outfit, in the same pose and the same camera framing as in this image, but in ${where}${r.style ? `, in the style of ${r.style}` : ""}${r.light ? `, with ${r.light}` : ""}. One single photograph. No text, no logos.`;
  return { prompt: lines.filter(Boolean).join(" "), scenePrompt };
}

const LABEL = { continue: "Continue", restage: "Restage" } as const;

/**
 * Creates a shot next to `anchor` and starts rendering it. `onInsert` runs inside the
 * reservation transaction, so the shot is linked to its story only if it was created.
 */
export async function createShot(
  deps: GeneratorDeps,
  args: {
    request: ShotRequest;
    anchor: Generation;
    source: Generation;
    sequenceId: string;
    newCharacters: Uint8Array[];
    sessionId: string;
    ip: string;
    onInsert: (tx: Prisma.TransactionClient, id: string) => Promise<void>;
  },
) {
  const { request: r, anchor, storage } = { ...args, storage: deps.storage };
  if (!anchor.videoPath) throw new ShotError("That clip hasn't finished rendering yet.", 409);
  const anchorVideo = storage.absolutePath(anchor.videoPath);
  const info = await probeCached(anchorVideo);
  const owned: string[] = [];
  const keep = async (bytes: Uint8Array, ext: string) => {
    const key = await storage.put(bytes, ext);
    owned.push(key);
    return key;
  };

  try {
    const inputs: Input[] = [];
    if (r.mode === "continue") {
      if (args.newCharacters.length > 0) throw new ShotError("Continue picks up from a frame, so it can't take new photos. Use Restage to add people.", 400);
      const which = r.side === "after" ? "last" : "first";
      inputs.push({ role: r.side === "after" ? "first_frame" : "last_frame", path: await keep(await frame(anchorVideo, which), "jpg") });
    } else {
      const sourceRefs = referencesOf(args.source).filter((x) => x.role === "character" || x.role === "location" || x.role === "product");
      const added: Input[] = [];
      for (const bytes of args.newCharacters) added.push({ role: "character", path: await keep(await prepareImage(bytes), "jpg") });
      // New people first, then the story's own references, in role order, up to H3's limit.
      const ordered = [...added, ...sourceRefs.map((x) => ({ ...x, shared: true }))];
      const byRole = ["character", "location", "product"].flatMap((role) => ordered.filter((x) => x.role === role));
      if (byRole.length > MAX_IMAGES) throw new ShotError(`H3 takes ${MAX_IMAGES} photos at most. Remove some new people.`, 400);
      inputs.push(...byRole, { role: "video", path: anchor.videoPath, shared: true });
    }

    const { prompt, scenePrompt } = shotPrompts(r, inputs.map((x) => x.role));
    const settings: ShotSettings = { kind: "shot", side: r.side, seconds: r.seconds, width: info.width, height: info.height, ratio: closestRatio(info.width, info.height), scenePrompt, inputs };
    const row = await reserveGeneration(
      deps,
      {
        genre: `story:${r.mode}`,
        effectName: LABEL[r.mode],
        shotMode: r.mode,
        sequenceId: args.sequenceId,
        caption: r.action || null,
        prompt,
        model: deps.provider.name,
        inputPath: inputs[0]!.path,
        references: settings as unknown as Prisma.InputJsonValue,
        resolution: anchor.resolution ?? "480P",
        aspectRatio: settings.ratio,
        sessionId: args.sessionId,
        ip: args.ip,
      },
      owned,
      args.onInsert,
    );
    void runShot(deps, row.id).catch((err) => deps.log.error({ id: row.id, err }, "shot crashed"));
    return row;
  } catch (err) {
    await Promise.all(owned.map((p) => storage.remove(p).catch(() => {})));
    throw err;
  }
}

export class ShotError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** A clip's reference photos, whether it was made from an effect or is itself a shot. */
function referencesOf(g: Generation): Input[] {
  const refs = g.references as unknown;
  if (Array.isArray(refs)) return refs as Input[];
  return (refs as ShotSettings | null)?.kind === "shot" ? (refs as ShotSettings).inputs : [];
}

/** Builds the graph for a stored shot and renders it. Safe to call again after a restart. */
export async function runShot(deps: GeneratorDeps, id: string): Promise<void> {
  const { db, provider, storage, cfg } = deps;
  let row;
  try {
    row = await db.generation.update({ where: { id }, data: { status: "running", progress: 3 } });
  } catch (err) {
    await db.generation.update({ where: { id }, data: { status: "failed", error: "The shot couldn't start. Please try again." } }).catch(() => {});
    throw err;
  }
  const s = row.references as unknown as ShotSettings;
  const read = async (key: string) => new Uint8Array(await fs.readFile(storage.absolutePath(key)));
  const find = (role: Input["role"]) => s.inputs.find((x) => x.role === role);

  await settle(deps, id, async () => {
    const resolution = row.resolution ?? "480P";
    let graph;
    const uploads: [string, string, Uint8Array, string][] = [];
    if (row.shotMode === "restage") {
      const images = s.inputs.filter((x) => x.role !== "video");
      graph = restageGraph({ prompt: row.prompt, seconds: s.seconds, resolution, ratio: s.ratio, imageTitles: images.map((x, i) => `Image ${i + 1}: ${x.role}`) });
      for (const [i, img] of images.entries()) uploads.push([`img_${i + 1}`, "image", await read(img.path), `image_${i + 1}.jpg`]);
      uploads.push(["motion", "file", await read(find("video")!.path), "motion.mp4"]);
    } else if (s.side === "after") {
      graph = continueGraph({ prompt: row.prompt, seconds: s.seconds, resolution, hasLastFrame: false });
      uploads.push(["first", "image", await read(find("first_frame")!.path), "first_frame.jpg"]);
    } else {
      graph = beforeGraph({ prompt: row.prompt, scenePrompt: s.scenePrompt ?? "", seconds: s.seconds, resolution, width: s.width, height: s.height, ratio: s.ratio });
      uploads.push(["first", "image", await read(find("last_frame")!.path), "clip_first_frame.jpg"]);
    }
    return provider.runGraph({
      graph,
      uploads,
      outputNode: SHOT_OUTPUT_NODE,
      kind: "video",
      seconds: s.seconds,
      onProgress: progressWriter(db, id),
      onJobCreated: async (jobId) => {
        await db.generation.update({ where: { id }, data: { comfyJobId: jobId } });
      },
      signal: AbortSignal.timeout(cfg.JOB_TIMEOUT_MINUTES * 60_000),
    });
  });
}

/** The stored files a shot owns (not the shared story references or the neighbour's video). */
export const ownedShotFiles = (row: Generation): string[] => {
  const s = row.references as unknown as ShotSettings | null;
  return s?.kind === "shot" ? s.inputs.filter((x) => !x.shared).map((x) => x.path) : [];
};
