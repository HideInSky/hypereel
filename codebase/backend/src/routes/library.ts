// Assets library: images, characters, character sheets and videos someone keeps across
// canvases. An Asset row with no canvas is a library item, owned by the session that made
// it; nobody else can see or change it. Saving and importing copy files, so a library item
// and a canvas card never share a file and each can be deleted on its own. Uploads,
// saves and edits are free; generating goes through the same image caps as canvases.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Asset, Prisma } from "@prisma/client";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { AssetLimitError, copyFiles, generateAsset, pathsOf, publicAsset, uploadAsset, variantOf } from "../services/assets.js";
import type { GeneratorDeps } from "../services/generator.js";
import { toPublic } from "./generations.js";

/** Most items one library holds, so a session can't fill the disk. */
export const MAX_LIBRARY_ITEMS = 500;
const MAX_CATEGORIES = 40;
export const BUILT_IN_CATEGORIES = [
  { id: "characters", name: "Characters" },
  { id: "places", name: "Places" },
  { id: "props", name: "Props" },
] as const;
const BUILT_IN_IDS = new Set<string>(BUILT_IN_CATEGORIES.map((c) => c.id));

const text = (max: number) => z.string().transform((t) => t.replace(/\s+/g, " ").trim()).pipe(z.string().max(max));
const libraryId = z.string().min(1).max(40);
export const VariantSchema = z
  .object({ outfit: text(200).optional(), style: text(200).optional() })
  .refine((v) => !(v.outfit && v.style), { message: "Change the outfit or the art style, not both at once." });
const CategoryField = z.string().min(1).max(40).nullable().optional();

/** Library items are never on a canvas; this is the one filter every query needs. */
const inLibrary = (sessionId: string): Prisma.AssetWhereInput => ({ sessionId, canvasId: null });

export async function libraryRoutes(app: FastifyInstance, ctx: AppContext) {
  const deps: GeneratorDeps = { db: ctx.db, provider: ctx.provider, storage: ctx.storage, cfg: ctx.cfg, log: app.log };
  const small = { bodyLimit: 64 * 1024 };
  const publicPath = (k: string) => ctx.storage.publicPath(k);

  function present(a: Asset) {
    const base = publicAsset(a, publicPath, a.sessionId);
    const sources = a.sources as string[];
    return {
      ...base,
      videoUrl: a.kind === "video" && pathsOf(a)[0] ? publicPath(pathsOf(a)[0]!) : null,
      category: a.category,
      favorite: a.favorite,
      position: a.position,
      usedAt: a.usedAt,
      prompt: a.kind === "sheet" ? sheetNote(a) : a.prompt,
      // Uploads and saved videos have nothing to remake them from.
      canRegenerate: ((a.kind === "sheet" && sources.length > 0) || ((a.kind === "image" || a.kind === "character") && !!a.prompt)),
    };
  }

  function sheetNote(a: Asset): string | null {
    const v = variantOf(a);
    return v?.outfit ? `New outfit: ${v.outfit}` : v?.style ? `New art style: ${v.style}` : null;
  }

  function signedIn(req: FastifyRequest, reply: FastifyReply): string | null {
    const viewer = ctx.readSessionId(req);
    if (!viewer) void reply.code(404).send({ error: "That isn't in your Assets." });
    return viewer;
  }

  async function mine(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<Asset | null> {
    const viewer = signedIn(req, reply);
    if (!viewer) return null;
    const item = await ctx.db.asset.findFirst({ where: { id: req.params.id, ...inLibrary(viewer) } });
    if (!item) void reply.code(404).send({ error: "That isn't in your Assets." });
    return item;
  }

  /** null when the category is fine, else the error to show. */
  async function badCategory(sessionId: string, category: string | null | undefined): Promise<string | null> {
    if (category == null || BUILT_IN_IDS.has(category)) return null;
    const found = await ctx.db.assetCategory.findFirst({ where: { id: category, sessionId } });
    return found ? null : "That category doesn't exist any more.";
  }

  async function roomFor(sessionId: string, more: number): Promise<boolean> {
    return (await ctx.db.asset.count({ where: inLibrary(sessionId) })) + more <= MAX_LIBRARY_ITEMS;
  }
  const FULL = `Your Assets hold ${MAX_LIBRARY_ITEMS} items at most. Delete some to make room.`;

  /** The viewer's finished library items with these ids, in the order given. */
  async function sources(sessionId: string, wanted: string[]): Promise<Asset[] | string> {
    if (wanted.length === 0) return [];
    const rows = await ctx.db.asset.findMany({ where: { id: { in: wanted }, ...inLibrary(sessionId) } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out: Asset[] = [];
    for (const id of wanted) {
      const a = byId.get(id);
      if (!a) return "One of those items isn't in your Assets any more.";
      if (a.status !== "succeeded") return `"${a.name}" isn't ready yet.`;
      if (a.kind === "video") return "Videos can't be used as image references.";
      out.push(a);
    }
    return out;
  }

  async function start(reply: FastifyReply, run: () => Promise<Asset>) {
    try {
      return reply.code(202).send(present(await run()));
    } catch (err) {
      if (err instanceof AssetLimitError) return reply.code(429).send({ error: err.message });
      throw err;
    }
  }

  app.get("/api/library", async (req) => {
    const viewer = ctx.readSessionId(req);
    const builtIn = BUILT_IN_CATEGORIES.map((c) => ({ ...c, builtIn: true }));
    if (!viewer) return { items: [], categories: builtIn };
    const [items, custom] = await Promise.all([
      ctx.db.asset.findMany({ where: inLibrary(viewer), orderBy: { createdAt: "desc" }, take: MAX_LIBRARY_ITEMS }),
      ctx.db.assetCategory.findMany({ where: { sessionId: viewer }, orderBy: { createdAt: "asc" } }),
    ]);
    return { items: items.map(present), categories: [...builtIn, ...custom.map((c) => ({ id: c.id, name: c.name, builtIn: false }))] };
  });

  app.post("/api/library/upload", async (req, reply) => {
    const sessionId = ctx.getSessionId(req, reply);
    const fields: Record<string, string> = {};
    const photos: Uint8Array[] = [];
    for await (const part of req.parts()) {
      if (part.type === "file") {
        const bytes = new Uint8Array(await part.toBuffer());
        if (part.fieldname === "photo" && bytes.length > 0) photos.push(bytes);
      } else fields[part.fieldname] = String(part.value);
    }
    const body = z.object({ kind: z.enum(["image", "character"]), name: text(60).default(""), category: z.string().max(40).optional() }).safeParse(fields);
    if (!body.success) return reply.code(400).send({ error: "Choose an image or a character." });
    if (photos.length === 0 || photos.length > 4) return reply.code(400).send({ error: "Add between 1 and 4 photos." });
    const category = body.data.category || null;
    const bad = await badCategory(sessionId, category);
    if (bad) return reply.code(400).send({ error: bad });
    if (!(await roomFor(sessionId, 1))) return reply.code(409).send({ error: FULL });
    try {
      const item = await uploadAsset(deps, { canvasId: null, kind: body.data.kind, name: body.data.name || (body.data.kind === "character" ? "Character" : "Image"), photos, sessionId, ip: ctx.clientIp(req), category });
      return reply.code(201).send(present(item));
    } catch (err) {
      app.log.warn({ err }, "bad library upload");
      return reply.code(400).send({ error: "One of those photos couldn't be read. Try a JPG or PNG." });
    }
  });

  app.post("/api/library/generate", small, async (req, reply) => {
    const body = z
      .object({ kind: z.enum(["image", "character"]), name: text(60).default(""), prompt: text(500).pipe(z.string().min(3, "Describe what to make.")), category: CategoryField, sourceIds: z.array(libraryId).max(4, "Use 4 reference items at most.").default([]) })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Describe what to make." });
    const sessionId = ctx.getSessionId(req, reply);
    const bad = await badCategory(sessionId, body.data.category);
    if (bad) return reply.code(400).send({ error: bad });
    const from = await sources(sessionId, body.data.sourceIds);
    if (typeof from === "string") return reply.code(409).send({ error: from });
    if (!(await roomFor(sessionId, 1))) return reply.code(409).send({ error: FULL });
    const { kind, prompt, category } = body.data;
    return start(reply, () => generateAsset(deps, { canvasId: null, kind, name: body.data.name || prompt.slice(0, 40), prompt, sources: from, category: category ?? null, sessionId, ip: ctx.clientIp(req) }));
  });

  app.post<{ Params: { id: string } }>("/api/library/:id/sheet", small, async (req, reply) => {
    const item = await mine(req, reply);
    if (!item) return;
    const variant = VariantSchema.safeParse(req.body ?? {});
    if (!variant.success) return reply.code(400).send({ error: variant.error.issues[0]?.message ?? "Describe the change in 200 characters or fewer." });
    const change = variant.data;
    if (item.kind !== "character" && item.kind !== "sheet") return reply.code(400).send({ error: "Character sheets are made from a character or another sheet." });
    if (item.kind === "sheet" && !change.outfit && !change.style) return reply.code(400).send({ error: "Describe a new outfit or art style for this sheet." });
    if (item.status !== "succeeded") return reply.code(409).send({ error: `"${item.name}" isn't ready yet.` });
    if (!(await roomFor(item.sessionId, 1))) return reply.code(409).send({ error: FULL });
    return start(reply, () =>
      generateAsset(deps, { canvasId: null, kind: "sheet", name: sheetName(item, change), prompt: "", sources: [item], variant: change, category: item.category ?? "characters", sessionId: item.sessionId, ip: ctx.clientIp(req) }),
    );
  });

  app.post<{ Params: { id: string } }>("/api/library/:id/regenerate", async (req, reply) => {
    const item = await mine(req, reply);
    if (!item) return;
    if (!present(item).canRegenerate) return reply.code(400).send({ error: "This one wasn't made from a prompt, so there's nothing to remake it from." });
    // Sources that were deleted since are dropped; a sheet still needs the one it came from.
    const wanted = item.sources as string[];
    const found = await ctx.db.asset.findMany({ where: { id: { in: wanted }, ...inLibrary(item.sessionId), status: "succeeded", kind: { not: "video" } } });
    const from = wanted.flatMap((id) => found.filter((f) => f.id === id));
    if (item.kind === "sheet" && from.length === 0) return reply.code(409).send({ error: "The character this sheet came from isn't in your Assets any more." });
    if (!(await roomFor(item.sessionId, 1))) return reply.code(409).send({ error: FULL });
    const kind = item.kind as "image" | "character" | "sheet";
    return start(reply, () =>
      generateAsset(deps, { canvasId: null, kind, name: item.name, prompt: item.prompt ?? "", sources: from, variant: variantOf(item), category: item.category, sessionId: item.sessionId, ip: ctx.clientIp(req) }),
    );
  });

  app.patch<{ Params: { id: string } }>("/api/library/:id", small, async (req, reply) => {
    const item = await mine(req, reply);
    if (!item) return;
    const body = z.object({ name: text(60).pipe(z.string().min(1, "Give it a name.")).optional(), category: CategoryField, favorite: z.boolean().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Those changes aren't valid." });
    const bad = await badCategory(item.sessionId, body.data.category);
    if (bad) return reply.code(400).send({ error: bad });
    const next = await ctx.db.asset.update({ where: { id: item.id }, data: { name: body.data.name, category: body.data.category, favorite: body.data.favorite } });
    return present(next);
  });

  // Custom order for the items shown in one view: positions follow the order given.
  app.put("/api/library/order", small, async (req, reply) => {
    const viewer = signedIn(req, reply);
    if (!viewer) return;
    const body = z.object({ ids: z.array(libraryId).max(MAX_LIBRARY_ITEMS) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "That order isn't valid." });
    await ctx.db.$executeRaw`
      UPDATE "Asset" AS a SET "position" = v.pos::int
      FROM unnest(${body.data.ids}::text[]) WITH ORDINALITY AS v(id, pos)
      WHERE a.id = v.id AND a."sessionId" = ${viewer} AND a."canvasId" IS NULL`;
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>("/api/library/:id", async (req, reply) => {
    const item = await mine(req, reply);
    if (!item) return;
    if (item.status === "queued" || item.status === "running") return reply.code(409).send({ error: "Wait for it to finish, then delete it." });
    await ctx.db.asset.delete({ where: { id: item.id } });
    await Promise.all(pathsOf(item).map((p) => ctx.storage.remove(p).catch(() => {})));
    return reply.code(204).send();
  });

  // Keep something made on a canvas, or a finished clip. Saving twice returns the first copy.
  app.post("/api/library/save", small, async (req, reply) => {
    const body = z
      .discriminatedUnion("from", [
        z.object({ from: z.literal("asset"), canvasId: libraryId, assetId: libraryId, category: CategoryField }),
        z.object({ from: z.literal("video"), generationId: libraryId, category: CategoryField }),
      ])
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Choose something to save." });
    const viewer = signedIn(req, reply);
    if (!viewer) return;
    const bad = await badCategory(viewer, body.data.category);
    if (bad) return reply.code(400).send({ error: bad });

    const originId = body.data.from === "asset" ? `asset:${body.data.assetId}` : `video:${body.data.generationId}`;
    const existing = await ctx.db.asset.findFirst({ where: { ...inLibrary(viewer), originId } });
    if (existing) return reply.code(200).send(present(existing));
    if (!(await roomFor(viewer, 1))) return reply.code(409).send({ error: FULL });

    const ip = ctx.clientIp(req);
    if (body.data.from === "asset") {
      const asset = await ctx.db.asset.findFirst({ where: { id: body.data.assetId, canvasId: body.data.canvasId, sessionId: viewer } });
      if (!asset) return reply.code(404).send({ error: "That card isn't on your canvas any more." });
      if (asset.status !== "succeeded") return reply.code(409).send({ error: `"${asset.name}" isn't ready yet.` });
      // Keep the "made from" link when its sources were saved too.
      const savedSources = await ctx.db.asset.findMany({ where: { ...inLibrary(viewer), originId: { in: (asset.sources as string[]).map((s) => `asset:${s}`) } }, select: { id: true } });
      const item = await ctx.db.asset.create({
        data: {
          canvasId: null, kind: asset.kind, name: asset.name, status: "succeeded", paths: await copyFiles(deps, pathsOf(asset)), prompt: asset.prompt,
          variant: asset.variant ?? undefined, sources: savedSources.map((s) => s.id), generated: false, originId, sessionId: viewer, ip,
          category: body.data.category !== undefined ? body.data.category : asset.kind === "image" ? null : "characters",
        },
      });
      return reply.code(201).send(present(item));
    }

    const clip = await ctx.db.generation.findFirst({ where: { id: body.data.generationId, sessionId: viewer } });
    if (!clip) return reply.code(404).send({ error: "That clip isn't yours, or it's gone." });
    if (clip.status !== "succeeded" || !clip.videoPath) return reply.code(409).send({ error: "Wait for the clip to finish rendering first." });
    const keys = [clip.videoPath, ...(clip.posterPath ? [clip.posterPath] : [])];
    const item = await ctx.db.asset.create({
      data: {
        canvasId: null, kind: "video", name: toPublic(clip, ctx, viewer).effectLabel.slice(0, 60), status: "succeeded", paths: await copyFiles(deps, keys),
        prompt: clip.caption, generated: false, originId, sessionId: viewer, ip, category: body.data.category ?? null,
      },
    });
    return reply.code(201).send(present(item));
  });

  app.post("/api/library/categories", small, async (req, reply) => {
    const body = z.object({ name: text(40).pipe(z.string().min(1, "Name the category.")) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Name the category." });
    const sessionId = ctx.getSessionId(req, reply);
    if (BUILT_IN_CATEGORIES.some((c) => c.name.toLowerCase() === body.data.name.toLowerCase())) return reply.code(409).send({ error: "That category already exists." });
    if ((await ctx.db.assetCategory.count({ where: { sessionId } })) >= MAX_CATEGORIES) return reply.code(409).send({ error: `You can have ${MAX_CATEGORIES} categories at most.` });
    try {
      const row = await ctx.db.assetCategory.create({ data: { name: body.data.name, sessionId } });
      return reply.code(201).send({ id: row.id, name: row.name, builtIn: false });
    } catch {
      return reply.code(409).send({ error: "That category already exists." });
    }
  });

  app.patch<{ Params: { id: string } }>("/api/library/categories/:id", small, async (req, reply) => {
    const viewer = signedIn(req, reply);
    if (!viewer) return;
    const body = z.object({ name: text(40).pipe(z.string().min(1, "Name the category.")) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Name the category." });
    const row = await ctx.db.assetCategory.findFirst({ where: { id: req.params.id, sessionId: viewer } });
    if (!row) return reply.code(404).send({ error: BUILT_IN_IDS.has(req.params.id) ? "Built-in categories can't be renamed." : "That category doesn't exist any more." });
    try {
      const next = await ctx.db.assetCategory.update({ where: { id: row.id }, data: { name: body.data.name } });
      return { id: next.id, name: next.name, builtIn: false };
    } catch {
      return reply.code(409).send({ error: "That category already exists." });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/library/categories/:id", async (req, reply) => {
    const viewer = signedIn(req, reply);
    if (!viewer) return;
    const row = await ctx.db.assetCategory.findFirst({ where: { id: req.params.id, sessionId: viewer } });
    if (!row) return reply.code(404).send({ error: BUILT_IN_IDS.has(req.params.id) ? "Built-in categories can't be deleted." : "That category doesn't exist any more." });
    // Items in it stay in the library, uncategorized.
    await ctx.db.$transaction([
      ctx.db.asset.updateMany({ where: { ...inLibrary(viewer), category: row.id }, data: { category: null } }),
      ctx.db.assetCategory.delete({ where: { id: row.id } }),
    ]);
    return reply.code(204).send();
  });
}

export function sheetName(from: Asset, change: { outfit?: string; style?: string }): string {
  const base = from.kind === "sheet" ? from.name.replace(/ \(.*\)$/, "") : `${from.name} sheet`;
  const extra = change.outfit ?? change.style;
  return (extra ? `${base} (${extra})` : base).slice(0, 60);
}
