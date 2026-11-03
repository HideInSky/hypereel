// Canvases: a free board of images, characters, character sheets and videos. Anyone
// with the link can look; only the maker (signed session cookie) can change it.
// Uploads and moving cards are free; anything a model makes costs credits and goes
// through the caps.
import { promises as fs } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Asset, Canvas, Prisma } from "@prisma/client";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { getEffect, sanitizeUserPrompt, type Effect, type ReferenceRole } from "../effects.js";
import { AssetError, AssetLimitError, copyFiles, generateAsset, pathsOf, publicAsset, uploadAsset, type SheetVariantInput } from "../services/assets.js";
import { sheetName, VariantSchema } from "./library.js";
import { createGeneration, LimitExceededError, type GeneratorDeps, type UploadedReference } from "../services/generator.js";
import { toPublic } from "./generations.js";

const CANVASES_PER_SESSION_PER_DAY = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CARDS = 300;
/** Most images the H3 reference node takes. */
const MAX_VIDEO_IMAGES = 9;
const CARD_GAP = 340;
const ROW_GAP = 280;

const CardSchema = z.object({ id: z.string().min(1).max(60), kind: z.enum(["asset", "video"]), refId: z.string().min(1).max(40), x: z.number().finite().min(-1e6).max(1e6), y: z.number().finite().min(-1e6).max(1e6) });
const BoardSchema = z.object({
  cards: z.array(CardSchema).max(MAX_CARDS),
  viewport: z.object({ x: z.number().finite().min(-1e7).max(1e7), y: z.number().finite().min(-1e7).max(1e7), zoom: z.number().min(0.1).max(4) }),
});
type Board = z.infer<typeof BoardSchema>;
type Card = z.infer<typeof CardSchema>;
const EMPTY_BOARD: Board = { cards: [], viewport: { x: 0, y: 0, zoom: 1 } };
const boardOf = (c: Canvas): Board => BoardSchema.catch(EMPTY_BOARD).parse(c.board);

const name = (max: number) => z.string().transform((t) => t.replace(/\s+/g, " ").trim()).pipe(z.string().max(max));
const ids = z.array(z.string().min(1).max(40)).max(9).default([]);

const VideoSchema = z.object({
  effect: z.string().max(80).optional(),
  prompt: name(500).optional(),
  characters: ids,
  locations: ids,
  products: ids,
  resolution: z.enum(["480P", "768P"]).default("480P"),
  aspectRatio: z.enum(["9:16", "3:4", "1:1", "16:9"]).default("9:16"),
  seconds: z.union([z.literal(5), z.literal(6), z.literal(8)]).default(5),
});

type Spot = { x: number; y: number };

/**
 * Places a new card next to the cards it came from, or below everything else. `taken`
 * adds spots that aren't cards but are drawn on the board: the shots of each video's
 * story, which sit in a row beside it.
 */
function placeCard(board: Board, card: Omit<Card, "x" | "y">, nearRefIds: string[], taken: Spot[] = []): Board {
  if (board.cards.some((c) => c.kind === card.kind && c.refId === card.refId)) return board;
  const occupied: Spot[] = [...board.cards, ...taken];
  const near = board.cards.filter((c) => nearRefIds.includes(c.refId));
  const anchor = near.length ? near.reduce((a, b) => (b.x > a.x ? b : a)) : null;
  const x = anchor ? anchor.x + CARD_GAP : 0;
  // Without a source, start a new row under everything, so nothing lands in a story row.
  let y = anchor ? anchor.y : occupied.length ? Math.max(...occupied.map((c) => c.y)) + ROW_GAP : 0;
  while (occupied.some((c) => Math.abs(c.x - x) < 200 && Math.abs(c.y - y) < 200)) y += ROW_GAP;
  return { ...board, cards: [...board.cards, { ...card, x, y }].slice(-MAX_CARDS) };
}

/** Where each video's story shots are drawn: in a row, before shots left, after shots right. */
async function storySpots(tx: Prisma.TransactionClient, board: Board): Promise<Spot[]> {
  const videos = board.cards.filter((c) => c.kind === "video");
  if (videos.length === 0) return [];
  const stories = await tx.sequence.findMany({ where: { sourceId: { in: videos.map((v) => v.refId) } }, select: { sourceId: true, shots: true } });
  return stories.flatMap((s) => {
    const card = videos.find((v) => v.refId === s.sourceId)!;
    const order = s.shots as string[];
    const at = order.indexOf(s.sourceId);
    return order.flatMap((_, i) => (i === at ? [] : [{ x: card.x + (i - at) * CARD_GAP, y: card.y }]));
  });
}

/** Adds a card under a row lock, so it can't be lost to a parallel change. */
async function addCard(ctx: AppContext, canvasId: string, card: Omit<Card, "x" | "y">, near: string[]) {
  return ctx.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Canvas" WHERE id = ${canvasId} FOR UPDATE`;
    const fresh = await tx.canvas.findUniqueOrThrow({ where: { id: canvasId } });
    const board = boardOf(fresh);
    const next = placeCard(board, card, near, await storySpots(tx, board));
    return tx.canvas.update({ where: { id: canvasId }, data: { board: next as unknown as Prisma.InputJsonValue } });
  });
}

async function removeCard(ctx: AppContext, canvasId: string, kind: Card["kind"], refId: string) {
  return ctx.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Canvas" WHERE id = ${canvasId} FOR UPDATE`;
    const fresh = await tx.canvas.findUniqueOrThrow({ where: { id: canvasId } });
    const board = boardOf(fresh);
    const next = { ...board, cards: board.cards.filter((c) => !(c.kind === kind && c.refId === refId)) };
    return tx.canvas.update({ where: { id: canvasId }, data: { board: next as unknown as Prisma.InputJsonValue } });
  });
}

export async function canvasRoutes(app: FastifyInstance, ctx: AppContext) {
  const deps: GeneratorDeps = { db: ctx.db, provider: ctx.provider, storage: ctx.storage, cfg: ctx.cfg, log: app.log };
  const small = { bodyLimit: 128 * 1024 };
  const publicPath = (k: string) => ctx.storage.publicPath(k);

  async function present(canvas: Canvas, viewer: string | null) {
    const [assets, videos] = await Promise.all([
      ctx.db.asset.findMany({ where: { canvasId: canvas.id }, orderBy: { createdAt: "asc" } }),
      ctx.db.generation.findMany({ where: { canvasId: canvas.id }, orderBy: { createdAt: "asc" } }),
    ]);
    const stories = videos.length
      ? await ctx.db.sequence.findMany({ where: { sourceId: { in: videos.map((v) => v.id) }, sessionId: canvas.sessionId }, select: { id: true, sourceId: true } })
      : [];
    const storyOf = new Map(stories.map((s) => [s.sourceId, s.id]));
    // Which cards the owner has kept in their Assets (nobody else sees this).
    const isOwner = viewer !== null && viewer === canvas.sessionId;
    const origins = [...assets.map((a) => `asset:${a.id}`), ...videos.map((v) => `video:${v.id}`)];
    const saved = isOwner && origins.length
      ? await ctx.db.asset.findMany({ where: { sessionId: viewer, canvasId: null, originId: { in: origins } }, select: { id: true, originId: true } })
      : [];
    const savedOf = new Map(saved.map((s) => [s.originId, s.id]));
    // A card brought in from Assets is already there, while its library item lasts.
    const fromLibrary = assets.flatMap((a) => (a.originId?.startsWith("library:") ? [a.originId.slice(8)] : []));
    const kept = isOwner && fromLibrary.length
      ? new Set((await ctx.db.asset.findMany({ where: { id: { in: fromLibrary }, sessionId: viewer, canvasId: null }, select: { id: true } })).map((r) => r.id))
      : new Set<string>();
    const savedIdOf = (a: Asset) => savedOf.get(`asset:${a.id}`) ?? (a.originId?.startsWith("library:") && kept.has(a.originId.slice(8)) ? a.originId.slice(8) : null);
    return {
      id: canvas.id,
      title: canvas.title,
      isOwner,
      board: boardOf(canvas),
      assets: assets.map((a) => ({ ...publicAsset(a, publicPath, viewer), savedId: savedIdOf(a) })),
      videos: videos.map((v) => ({
        ...toPublic(v, ctx, viewer),
        assetIds: [...new Set(((v.references as { assetId?: string }[] | null) ?? []).flatMap((r) => (r.assetId ? [r.assetId] : [])))],
        storyId: storyOf.get(v.id) ?? null,
        savedId: savedOf.get(`video:${v.id}`) ?? null,
      })),
      shareUrl: `${ctx.cfg.PUBLIC_URL}/?canvas=${canvas.id}`,
    };
  }

  async function owned(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const canvas = await ctx.db.canvas.findUnique({ where: { id: req.params.id } });
    if (!canvas) { void reply.code(404).send({ error: "Not found" }); return null; }
    const viewer = ctx.readSessionId(req);
    if (viewer !== canvas.sessionId) { void reply.code(403).send({ error: "Only the person who made this canvas can change it." }); return null; }
    return { canvas, viewer };
  }

  /** The canvas's own finished assets with these ids, in the order given. */
  async function assetsById(canvasId: string, wanted: string[]): Promise<Asset[] | string> {
    if (wanted.length === 0) return [];
    const rows = await ctx.db.asset.findMany({ where: { id: { in: wanted }, canvasId } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out: Asset[] = [];
    for (const id of wanted) {
      const a = byId.get(id);
      if (!a) return "One of those cards isn't on this canvas any more.";
      if (a.status !== "succeeded") return `"${a.name}" isn't ready yet.`;
      out.push(a);
    }
    return out;
  }

  app.post("/api/canvases", small, async (req, reply) => {
    const body = z.object({ title: name(80).optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "That title is too long." });
    const sessionId = ctx.getSessionId(req, reply);
    const recent = await ctx.db.canvas.count({ where: { sessionId, createdAt: { gte: new Date(Date.now() - DAY_MS) } } });
    if (recent >= CANVASES_PER_SESSION_PER_DAY) return reply.code(429).send({ error: "That's a lot of new canvases for one day. Try again tomorrow." });
    const canvas = await ctx.db.canvas.create({ data: { title: body.data.title || "Untitled canvas", board: EMPTY_BOARD, sessionId, ip: ctx.clientIp(req) } });
    return reply.code(201).send(await present(canvas, sessionId));
  });

  app.get("/api/canvases", async (req) => {
    const viewer = ctx.readSessionId(req);
    if (!viewer) return [];
    const rows = await ctx.db.canvas.findMany({ where: { sessionId: viewer }, orderBy: { updatedAt: "desc" }, take: 50 });
    const covers = await ctx.db.asset.findMany({ where: { canvasId: { in: rows.map((r) => r.id) }, status: "succeeded" }, orderBy: { createdAt: "asc" }, distinct: ["canvasId"] });
    const coverOf = new Map(covers.map((a) => [a.canvasId, pathsOf(a)[0]]));
    return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt, cover: coverOf.get(r.id) ? publicPath(coverOf.get(r.id)!) : null }));
  });

  app.get<{ Params: { id: string } }>("/api/canvases/:id", async (req, reply) => {
    const canvas = await ctx.db.canvas.findUnique({ where: { id: req.params.id } });
    if (!canvas) return reply.code(404).send({ error: "Not found" });
    return present(canvas, ctx.readSessionId(req));
  });

  // Moves cards and the view. Which cards exist is decided by the server (cards come and
  // go with assets and videos), so only positions of known cards and the viewport apply.
  app.patch<{ Params: { id: string } }>("/api/canvases/:id", small, async (req, reply) => {
    const found = await owned(req, reply);
    if (!found) return;
    const body = z.object({ title: name(80).optional(), board: BoardSchema.optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Those canvas changes aren't valid." });
    const canvas = await ctx.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Canvas" WHERE id = ${found.canvas.id} FOR UPDATE`;
      const fresh = await tx.canvas.findUniqueOrThrow({ where: { id: found.canvas.id } });
      const current = boardOf(fresh);
      let board = current;
      if (body.data.board) {
        const moved = new Map(body.data.board.cards.map((c) => [`${c.kind}:${c.refId}`, c]));
        board = {
          viewport: body.data.board.viewport,
          cards: current.cards.map((c) => {
            const m = moved.get(`${c.kind}:${c.refId}`);
            return m ? { ...c, x: m.x, y: m.y } : c;
          }),
        };
      }
      return tx.canvas.update({ where: { id: fresh.id }, data: { title: body.data.title || fresh.title, board: board as unknown as Prisma.InputJsonValue } });
    });
    return present(canvas, found.viewer);
  });

  app.post<{ Params: { id: string } }>("/api/canvases/:id/assets", async (req, reply) => {
    const found = await owned(req, reply);
    if (!found) return;
    const fields: Record<string, string> = {};
    const photos: Uint8Array[] = [];
    for await (const part of req.parts()) {
      if (part.type === "file") {
        const bytes = new Uint8Array(await part.toBuffer());
        if (part.fieldname === "photo" && bytes.length > 0) photos.push(bytes);
      } else fields[part.fieldname] = String(part.value);
    }
    const body = z.object({ kind: z.enum(["image", "character"]), name: name(60).default("") }).safeParse(fields);
    if (!body.success) return reply.code(400).send({ error: "Choose an image or a character." });
    if (photos.length === 0 || photos.length > 4) return reply.code(400).send({ error: "Add between 1 and 4 photos." });
    try {
      const asset = await uploadAsset(deps, { canvasId: found.canvas.id, kind: body.data.kind, name: body.data.name || (body.data.kind === "character" ? "Character" : "Image"), photos, sessionId: found.viewer!, ip: ctx.clientIp(req) });
      const canvas = await addCard(ctx, found.canvas.id, { id: `asset-${asset.id}`, kind: "asset", refId: asset.id }, []);
      return reply.code(201).send(await present(canvas, found.viewer));
    } catch (err) {
      app.log.warn({ err }, "bad canvas upload");
      return reply.code(400).send({ error: "One of those photos couldn't be read. Try a JPG or PNG." });
    }
  });

  app.post<{ Params: { id: string } }>("/api/canvases/:id/assets/generate", small, async (req, reply) => {
    const found = await owned(req, reply);
    if (!found) return;
    const body = z.object({ kind: z.enum(["image", "character"]), name: name(60).default(""), prompt: name(500).pipe(z.string().min(3, "Describe what to make.")), sourceIds: ids.pipe(z.array(z.string()).max(4, "Use 4 reference cards at most.")) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Describe what to make." });
    const sources = await assetsById(found.canvas.id, body.data.sourceIds);
    if (typeof sources === "string") return reply.code(409).send({ error: sources });
    return startAsset(req, reply, found, { kind: body.data.kind, name: body.data.name || body.data.prompt.slice(0, 40), prompt: body.data.prompt, sources });
  });

  // A character sheet from a character card, or a new outfit or art style from a sheet.
  app.post<{ Params: { id: string; assetId: string } }>("/api/canvases/:id/assets/:assetId/sheet", small, async (req, reply) => {
    const found = await owned(req, reply);
    if (!found) return;
    const variant = VariantSchema.safeParse(req.body ?? {});
    if (!variant.success) return reply.code(400).send({ error: variant.error.issues[0]?.message ?? "Describe the change in 200 characters or fewer." });
    const sources = await assetsById(found.canvas.id, [req.params.assetId]);
    if (typeof sources === "string") return reply.code(409).send({ error: sources });
    const from = sources[0]!;
    if (from.kind !== "character" && from.kind !== "sheet") return reply.code(400).send({ error: "Character sheets are made from a character card or another sheet." });
    if (from.kind === "sheet" && !variant.data.outfit && !variant.data.style) return reply.code(400).send({ error: "Describe a new outfit or art style for this sheet." });
    return startAsset(req, reply, found, { kind: "sheet", name: sheetName(from, variant.data), prompt: "", sources, variant: variant.data });
  });

  // Copies items from the viewer's Assets onto the board, so each can be deleted on its own.
  app.post<{ Params: { id: string } }>("/api/canvases/:id/assets/import", small, async (req, reply) => {
    const found = await owned(req, reply);
    if (!found) return;
    const body = z.object({ ids: z.array(z.string().min(1).max(40)).min(1, "Pick something to add.").max(10, "Add 10 items at a time at most.") }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Pick something to add." });
    const wanted = [...new Set(body.data.ids)];
    const rows = await ctx.db.asset.findMany({ where: { id: { in: wanted }, sessionId: found.viewer!, canvasId: null } });
    if (rows.length !== wanted.length) return reply.code(404).send({ error: "One of those items isn't in your Assets any more." });
    if (rows.some((r) => r.kind === "video")) return reply.code(400).send({ error: "Videos can't go on a canvas yet. Pick images, characters or sheets." });
    const notReady = rows.find((r) => r.status !== "succeeded");
    if (notReady) return reply.code(409).send({ error: `"${notReady.name}" isn't ready yet.` });
    let canvas = found.canvas;
    for (const id of wanted) {
      const item = rows.find((r) => r.id === id)!;
      const copy = await ctx.db.asset.create({
        data: {
          canvasId: found.canvas.id, kind: item.kind, name: item.name, status: "succeeded", paths: await copyFiles(deps, pathsOf(item)), prompt: item.prompt,
          variant: item.variant ?? undefined, generated: false, originId: `library:${item.id}`, sessionId: found.viewer!, ip: ctx.clientIp(req),
        },
      });
      canvas = await addCard(ctx, found.canvas.id, { id: `asset-${copy.id}`, kind: "asset", refId: copy.id }, []);
    }
    await ctx.db.asset.updateMany({ where: { id: { in: wanted } }, data: { usedAt: new Date() } });
    return reply.code(201).send(await present(canvas, found.viewer));
  });

  async function startAsset(
    req: FastifyRequest,
    reply: FastifyReply,
    found: { canvas: Canvas; viewer: string | null },
    args: { kind: "image" | "character" | "sheet"; name: string; prompt: string; sources: Asset[]; variant?: SheetVariantInput },
  ) {
    try {
      const asset = await generateAsset(deps, { canvasId: found.canvas.id, ...args, sessionId: found.viewer!, ip: ctx.clientIp(req) });
      const canvas = await addCard(ctx, found.canvas.id, { id: `asset-${asset.id}`, kind: "asset", refId: asset.id }, args.sources.map((s) => s.id));
      return reply.code(202).send(await present(canvas, found.viewer));
    } catch (err) {
      if (err instanceof AssetLimitError) return reply.code(429).send({ error: err.message });
      if (err instanceof AssetError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  }

  app.delete<{ Params: { id: string; assetId: string } }>("/api/canvases/:id/assets/:assetId", async (req, reply) => {
    const found = await owned(req, reply);
    if (!found) return;
    const asset = await ctx.db.asset.findUnique({ where: { id: req.params.assetId } });
    if (asset?.canvasId === found.canvas.id) {
      if (asset.status === "queued" || asset.status === "running") return reply.code(409).send({ error: "Wait for it to finish, then remove it." });
      await ctx.db.asset.delete({ where: { id: asset.id } });
      // Videos already made keep their own copies of the photos.
      await Promise.all(pathsOf(asset).map((p) => ctx.storage.remove(p).catch(() => {})));
    }
    const canvas = await removeCard(ctx, found.canvas.id, "asset", req.params.assetId);
    return present(canvas, found.viewer);
  });

  app.post<{ Params: { id: string } }>("/api/canvases/:id/videos", small, async (req, reply) => {
    const found = await owned(req, reply);
    if (!found) return;
    const parsed = VideoSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Those video settings aren't valid." });
    const v = parsed.data;
    if (v.characters.length === 0) return reply.code(400).send({ error: "Pick at least one character card." });
    if (v.characters.length > 4) return reply.code(400).send({ error: "Pick 4 character cards at most." });

    let effect: Effect;
    if (v.effect) {
      const found = getEffect(v.effect);
      if (!found) return reply.code(400).send({ error: "Pick an effect from the list." });
      effect = found;
    } else {
      if (!v.prompt || v.prompt.length < 3) return reply.code(400).send({ error: "Describe what happens in the video, or pick an effect." });
      const text = v.prompt;
      effect = { id: "canvas:prompt", label: "Video", description: "", seconds: v.seconds, motion: () => `${text.replace(/[.!?]$/, "")}.` };
    }

    const groups: [ReferenceRole, string[]][] = [["character", v.characters], ["location", v.locations], ["product", v.products]];
    const references: UploadedReference[] = [];
    const assetIds: string[] = [];
    for (const [role, wanted] of groups) {
      const assets = await assetsById(found.canvas.id, wanted);
      if (typeof assets === "string") return reply.code(409).send({ error: assets });
      for (const a of assets) {
        for (const key of pathsOf(a)) {
          references.push({ role, bytes: new Uint8Array(await fs.readFile(ctx.storage.absolutePath(key))) });
          assetIds.push(a.id);
        }
      }
    }
    if (references.length > MAX_VIDEO_IMAGES) {
      return reply.code(400).send({ error: `Those cards hold ${references.length} photos. MiniMax H3 takes ${MAX_VIDEO_IMAGES} at most.` });
    }

    try {
      const row = await createGeneration(deps, {
        effect,
        references,
        userPrompt: v.effect ? sanitizeUserPrompt(v.prompt) : "",
        resolution: v.resolution,
        aspectRatio: v.aspectRatio,
        sessionId: found.viewer!,
        ip: ctx.clientIp(req),
        canvasId: found.canvas.id,
        assetIds,
      });
      const canvas = await addCard(ctx, found.canvas.id, { id: `video-${row.id}`, kind: "video", refId: row.id }, [...new Set(assetIds)]);
      return reply.code(202).send(await present(canvas, found.viewer));
    } catch (err) {
      if (err instanceof LimitExceededError) return reply.code(429).send({ error: err.message, reason: err.reason });
      throw err;
    }
  });

  // Every video can grow into a story (shots before and after it). One story per video.
  app.post<{ Params: { id: string; videoId: string } }>("/api/canvases/:id/videos/:videoId/story", async (req, reply) => {
    const found = await owned(req, reply);
    if (!found) return;
    const video = await ctx.db.generation.findUnique({ where: { id: req.params.videoId } });
    if (!video || video.canvasId !== found.canvas.id) return reply.code(404).send({ error: "That video isn't on this canvas." });
    if (video.status !== "succeeded") return reply.code(409).send({ error: "Wait for the video to finish rendering first." });
    const story = await ctx.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Canvas" WHERE id = ${found.canvas.id} FOR UPDATE`;
      const existing = await tx.sequence.findFirst({ where: { sourceId: video.id, sessionId: found.viewer! } });
      return existing ?? tx.sequence.create({ data: { sourceId: video.id, shots: [video.id], sessionId: found.viewer!, ip: ctx.clientIp(req), title: `${found.canvas.title} story` } });
    });
    return { storyId: story.id };
  });

  app.delete<{ Params: { id: string; videoId: string } }>("/api/canvases/:id/videos/:videoId", async (req, reply) => {
    const found = await owned(req, reply);
    if (!found) return;
    // The clip itself stays in History; it just leaves the board.
    await ctx.db.generation.updateMany({ where: { id: req.params.videoId, canvasId: found.canvas.id }, data: { canvasId: null } });
    const canvas = await removeCard(ctx, found.canvas.id, "video", req.params.videoId);
    return present(canvas, found.viewer);
  });

}
