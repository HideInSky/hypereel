// Stories: a clip plus shots added before and after it, and sound layers over all of
// them. Anyone with the link can watch; only the owner (signed session cookie) can edit.
// Rendering shots and AI sounds costs credits and goes through the caps; editing the
// order, the sound layers and exporting cost nothing.
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AudioClip, Generation, Prisma, Sequence } from "@prisma/client";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { LimitExceededError, type GeneratorDeps } from "../services/generator.js";
import { probeCached, renderStory } from "../services/media.js";
import { createShot, MAX_NEW_CHARACTERS, ownedShotFiles, ShotError, ShotRequestSchema, type ShotSettings } from "../services/shots.js";
import { createSound, LayersSchema, originalSound, publicClip, shiftOriginalLayers, soundLibrary, SoundLimitError, AudioRequestSchema, type Layer } from "../services/storyAudio.js";
import { toPublic } from "./generations.js";

const STORIES_PER_SESSION_PER_DAY = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const shotIds = (s: Sequence) => s.shots as string[];

/** Moves the original-sound layers of every clip in `moved` by `delta` seconds. */
async function shiftLayers(tx: Prisma.TransactionClient, seq: Sequence, moved: string[], delta: number) {
  const layers = layersOf(seq);
  const clipIds = layers.flatMap((l) => ("clipId" in l.source ? [l.source.clipId] : []));
  if (clipIds.length === 0 || moved.length === 0) return layers;
  const clips = await tx.audioClip.findMany({ where: { id: { in: clipIds }, kind: "original" } });
  const clipShot = new Map(clips.flatMap((c) => (c.shotId ? [[c.id, c.shotId] as [string, string]] : [])));
  return shiftOriginalLayers(layers, clipShot, new Set(moved), delta);
}

/** The length a shot was asked to be. Inserts and deletes move sound layers by this, so they cancel out. */
const nominalSeconds = (g: Generation) => {
  const s = g.references as unknown as ShotSettings | null;
  return s?.kind === "shot" ? s.seconds : 0;
};

/** How long a clip lasts on the timeline: its real length once rendered. */
async function shotSeconds(ctx: AppContext, g: Generation): Promise<number> {
  const s = g.references as unknown as ShotSettings | null;
  const nominal = s?.kind === "shot" ? s.seconds : 5;
  return g.videoPath ? probeCached(ctx.storage.absolutePath(g.videoPath)).then((i) => i.seconds).catch(() => nominal) : nominal;
}
const layersOf = (s: Sequence) => LayersSchema.catch([]).parse(s.audio);

export async function sequenceRoutes(app: FastifyInstance, ctx: AppContext) {
  const deps: GeneratorDeps = { db: ctx.db, provider: ctx.provider, storage: ctx.storage, cfg: ctx.cfg, log: app.log };
  const small = { bodyLimit: 64 * 1024 };

  /** The story as the client sees it. Shots come back in story order. */
  async function present(seq: Sequence, viewer: string | null) {
    const ids = shotIds(seq);
    const rows = await ctx.db.generation.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const shots = await Promise.all(
      ids.flatMap((id) => {
        const g = byId.get(id);
        return g ? [g] : [];
      }).map(async (g) => {
        const s = g.references as unknown as ShotSettings | null;
        const seconds = await shotSeconds(ctx, g);
        return { ...toPublic(g, ctx, viewer), mode: (g.shotMode ?? "original") as "original" | "continue" | "restage", side: s?.kind === "shot" ? s.side : null, seconds };
      }),
    );
    const layers = layersOf(seq);
    const clipIds = layers.flatMap((l) => ("clipId" in l.source ? [l.source.clipId] : []));
    const clips = clipIds.length ? await ctx.db.audioClip.findMany({ where: { id: { in: clipIds } } }) : [];
    const totalSeconds = shots.reduce((n, s) => n + s.seconds, 0);
    const stale = seq.exportedAt ? seq.editedAt > seq.exportedAt : false;
    return {
      id: seq.id,
      title: seq.title,
      isOwner: viewer !== null && viewer === seq.sessionId,
      shots,
      audio: layers,
      clips: Object.fromEntries(clips.map((c) => [c.id, publicClip(c, (k) => ctx.storage.publicPath(k), viewer)])),
      totalSeconds,
      export: {
        status: seq.exportStatus as null | "rendering" | "ready" | "failed",
        url: seq.exportPath ? ctx.storage.publicPath(seq.exportPath) : null,
        stale,
        error: seq.exportStatus === "failed" ? seq.exportError : null,
      },
      shareUrl: `${ctx.cfg.PUBLIC_URL}/?story=${seq.id}`,
    };
  }

  /** Loads a story the current visitor owns, or answers 404 / 403. */
  async function owned(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const seq = await ctx.db.sequence.findUnique({ where: { id: req.params.id } });
    if (!seq) { void reply.code(404).send({ error: "Not found" }); return null; }
    const viewer = ctx.readSessionId(req);
    if (viewer !== seq.sessionId) { void reply.code(403).send({ error: "Only the person who made this story can change it." }); return null; }
    return { seq, viewer };
  }

  app.post("/api/sequences", small, async (req, reply) => {
    const body = z.object({ sourceId: z.string().min(1).max(40) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Pick a finished clip to start from." });
    const sessionId = ctx.getSessionId(req, reply);
    const source = await ctx.db.generation.findUnique({ where: { id: body.data.sourceId } });
    if (!source || source.sessionId !== sessionId) return reply.code(404).send({ error: "That clip isn't yours, or it no longer exists." });
    if (source.status !== "succeeded") return reply.code(409).send({ error: "Wait for the clip to finish rendering first." });
    const recent = await ctx.db.sequence.count({ where: { sessionId, createdAt: { gte: new Date(Date.now() - DAY_MS) } } });
    if (recent >= STORIES_PER_SESSION_PER_DAY) return reply.code(429).send({ error: "That's a lot of new stories for one day. Try again tomorrow." });
    const seq = await ctx.db.sequence.create({ data: { sourceId: source.id, shots: [source.id], sessionId, ip: ctx.clientIp(req), title: `${source.effectName ?? "My"} story` } });
    return reply.code(201).send(await present(seq, sessionId));
  });

  app.get("/api/sequences", async (req) => {
    const viewer = ctx.readSessionId(req);
    if (!viewer) return [];
    const rows = await ctx.db.sequence.findMany({ where: { sessionId: viewer }, orderBy: { createdAt: "desc" }, take: 30 });
    return rows.map((s) => ({ id: s.id, title: s.title, shots: shotIds(s).length, createdAt: s.createdAt }));
  });

  app.get<{ Params: { id: string } }>("/api/sequences/:id", async (req, reply) => {
    const seq = await ctx.db.sequence.findUnique({ where: { id: req.params.id } });
    if (!seq) return reply.code(404).send({ error: "Not found" });
    return present(seq, ctx.readSessionId(req));
  });

  app.post<{ Params: { id: string } }>("/api/sequences/:id/shots", async (req, reply) => {
    const found = await owned(req, reply);
    if (!found) return;
    const fields: Record<string, string> = {};
    const characters: Uint8Array[] = [];
    for await (const part of req.parts()) {
      if (part.type === "file") {
        const bytes = new Uint8Array(await part.toBuffer());
        if (part.fieldname === "character" && bytes.length > 0) characters.push(bytes);
      } else fields[part.fieldname] = String(part.value);
    }
    const parsed = ShotRequestSchema.safeParse(fields);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Those shot settings aren't valid." });
    if (characters.length > MAX_NEW_CHARACTERS) return reply.code(400).send({ error: `Add ${MAX_NEW_CHARACTERS} new people at most.` });
    const ids = shotIds(found.seq);
    if (!ids.includes(parsed.data.anchorId)) return reply.code(400).send({ error: "That clip isn't part of this story." });
    const [anchor, source] = await Promise.all([
      ctx.db.generation.findUnique({ where: { id: parsed.data.anchorId } }),
      ctx.db.generation.findUnique({ where: { id: found.seq.sourceId } }),
    ]);
    if (!anchor || anchor.status !== "succeeded" || !source) return reply.code(409).send({ error: "Wait for that clip to finish rendering, then add the shot." });

    const sessionId = found.viewer!;
    try {
      await createShot(deps, {
        request: parsed.data,
        anchor,
        source,
        sequenceId: found.seq.id,
        newCharacters: characters,
        sessionId,
        ip: ctx.clientIp(req),
        // Re-read the order under a row lock, so two quick additions can't overwrite each other.
        onInsert: async (tx, shotId) => {
          await tx.$queryRaw`SELECT id FROM "Sequence" WHERE id = ${found.seq.id} FOR UPDATE`;
          const fresh = await tx.sequence.findUniqueOrThrow({ where: { id: found.seq.id } });
          const order = shotIds(fresh);
          const at = order.indexOf(parsed.data.anchorId);
          if (at < 0) throw new ShotError("That clip was removed from the story.", 409);
          const insertAt = parsed.data.side === "after" ? at + 1 : at;
          const moved = order.slice(insertAt);
          order.splice(insertAt, 0, shotId);
          const audio = await shiftLayers(tx, fresh, moved, parsed.data.seconds);
          await tx.sequence.update({ where: { id: fresh.id }, data: { shots: order, audio, editedAt: new Date() } });
        },
      });
    } catch (err) {
      if (err instanceof LimitExceededError) return reply.code(429).send({ error: err.message, reason: err.reason });
      if (err instanceof ShotError) return reply.code(err.status).send({ error: err.message });
      app.log.warn({ err }, "could not add shot");
      return reply.code(400).send({ error: "That shot couldn't be added. If you attached photos, try JPG or PNG." });
    }
    const seq = await ctx.db.sequence.findUniqueOrThrow({ where: { id: found.seq.id } });
    return reply.code(202).send(await present(seq, sessionId));
  });

  app.delete<{ Params: { id: string; shotId: string } }>("/api/sequences/:id/shots/:shotId", async (req, reply) => {
    const found = await owned(req, reply);
    if (!found) return;
    if (req.params.shotId === found.seq.sourceId) return reply.code(400).send({ error: "The clip the story started from can't be removed." });
    const shot = await ctx.db.generation.findUnique({ where: { id: req.params.shotId } });
    const gone = shot ? nominalSeconds(shot) : 0;
    const seq = await ctx.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Sequence" WHERE id = ${found.seq.id} FOR UPDATE`;
      const fresh = await tx.sequence.findUniqueOrThrow({ where: { id: found.seq.id } });
      const order = shotIds(fresh);
      const at = order.indexOf(req.params.shotId);
      if (at < 0) return fresh;
      const audio = await shiftLayers(tx, fresh, order.slice(at + 1), -gone);
      return tx.sequence.update({ where: { id: fresh.id }, data: { shots: order.filter((id) => id !== req.params.shotId), audio, editedAt: new Date() } });
    });
    // The shot's row stays (it was paid for, and it shows in History), but its private inputs can go.
    if (shot?.sequenceId === seq.id && shot.status !== "queued" && shot.status !== "running") {
      await Promise.all(ownedShotFiles(shot).map((p) => ctx.storage.remove(p).catch(() => {})));
    }
    return present(seq, found.viewer);
  });

  app.put<{ Params: { id: string } }>("/api/sequences/:id/audio", small, async (req, reply) => {
    const found = await owned(req, reply);
    if (!found) return;
    const parsed = LayersSchema.safeParse((req.body as { layers?: unknown } | null)?.layers);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Those sound layers aren't valid." });
    const library = new Set(soundLibrary().sounds.map((s) => s.id));
    const clipIds = parsed.data.flatMap((l) => ("clipId" in l.source ? [l.source.clipId] : []));
    const clips = await ctx.db.audioClip.findMany({ where: { id: { in: clipIds } } });
    // A layer may only use this visitor's own sounds, or library sounds that exist.
    const usable = new Set(clips.filter((c) => c.sessionId === found.viewer).map((c) => c.id));
    const bad = parsed.data.find((l) => ("clipId" in l.source ? !usable.has(l.source.clipId) : !library.has(l.source.sound)));
    if (bad) return reply.code(400).send({ error: `The sound "${bad.label}" isn't available.` });
    const seq = await ctx.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Sequence" WHERE id = ${found.seq.id} FOR UPDATE`;
      return tx.sequence.update({ where: { id: found.seq.id }, data: { audio: parsed.data, editedAt: new Date() } });
    });
    return present(seq, found.viewer);
  });

  app.post<{ Params: { id: string } }>("/api/sequences/:id/export", async (req, reply) => {
    const found = await owned(req, reply);
    if (!found) return;
    const ids = shotIds(found.seq);
    const shots = await ctx.db.generation.findMany({ where: { id: { in: ids } } });
    const ready = new Map(shots.filter((g) => g.status === "succeeded" && g.videoPath).map((g) => [g.id, g]));
    const order = ids.filter((id) => ready.has(id));
    if (ids.some((id) => shots.find((g) => g.id === id && (g.status === "queued" || g.status === "running")))) {
      return reply.code(409).send({ error: "Some shots are still rendering. Export when they're done." });
    }
    // Sound layers are placed by time, so a missing shot would shift everything after it.
    if (ids.some((id) => !ready.has(id))) {
      return reply.code(409).send({ error: "A shot didn't render. Remove it from the story, then export." });
    }
    if (order.length === 0) return reply.code(409).send({ error: "There's nothing finished to export yet." });
    const layers = layersOf(found.seq);
    const resolved = await resolveLayers(layers, ctx);
    if (typeof resolved === "string") return reply.code(409).send({ error: resolved });

    // Only one export at a time per story: a second click returns the running one.
    const claimed = await ctx.db.sequence.updateMany({
      where: { id: found.seq.id, OR: [{ exportStatus: null }, { exportStatus: { not: "rendering" } }] },
      data: { exportStatus: "rendering", exportError: null },
    });
    if (claimed.count === 1) {
      const editedAt = found.seq.editedAt;
      void (async () => {
        const first = ready.get(order[0]!)!;
        const size = await probeCached(ctx.storage.absolutePath(first.videoPath!));
        const bytes = await renderStory({
          shots: order.map((id) => ctx.storage.absolutePath(ready.get(id)!.videoPath!)),
          layers: resolved,
          width: size.width - (size.width % 2),
          height: size.height - (size.height % 2),
        });
        const key = await ctx.storage.put(bytes, "mp4");
        const old = (await ctx.db.sequence.findUnique({ where: { id: found.seq.id } }))?.exportPath;
        await ctx.db.sequence.update({ where: { id: found.seq.id }, data: { exportStatus: "ready", exportPath: key, exportedAt: editedAt, exportError: null } });
        if (old && old !== key) await ctx.storage.remove(old).catch(() => {});
        app.log.info({ id: found.seq.id, shots: order.length, layers: resolved.length }, "story exported");
      })().catch(async (err) => {
        app.log.error({ id: found.seq.id, err: String(err) }, "story export failed");
        await ctx.db.sequence.update({ where: { id: found.seq.id }, data: { exportStatus: "failed", exportError: "The video couldn't be put together. Try again, or remove the last sound you added." } }).catch(() => {});
      });
    }
    const seq = await ctx.db.sequence.findUniqueOrThrow({ where: { id: found.seq.id } });
    return reply.code(202).send(await present(seq, found.viewer));
  });

  app.post("/api/audio", small, async (req, reply) => {
    const parsed = AudioRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Describe the sound and its length." });
    try {
      const clip = await createSound(deps, { ...parsed.data, sessionId: ctx.getSessionId(req, reply), ip: ctx.clientIp(req) });
      return reply.code(202).send(publicClip(clip, (k) => ctx.storage.publicPath(k), clip.sessionId));
    } catch (err) {
      if (err instanceof SoundLimitError) return reply.code(429).send({ error: err.message });
      throw err;
    }
  });

  app.post("/api/audio/original", small, async (req, reply) => {
    const body = z.object({ shotId: z.string().min(1).max(40) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Pick a clip." });
    const sessionId = ctx.getSessionId(req, reply);
    const shot: Generation | null = await ctx.db.generation.findUnique({ where: { id: body.data.shotId } });
    if (!shot || shot.sessionId !== sessionId) return reply.code(404).send({ error: "That clip isn't yours, or it no longer exists." });
    const label = `Original sound: ${toPublic(shot, ctx, sessionId).effectLabel}`;
    const clip: AudioClip | null = await originalSound(deps, shot, label, { sessionId, ip: ctx.clientIp(req) });
    if (!clip) return reply.code(422).send({ error: "That clip has no sound to use." });
    return reply.code(201).send(publicClip(clip, (k) => ctx.storage.publicPath(k), sessionId));
  });

  app.get<{ Params: { id: string } }>("/api/audio/:id", async (req, reply) => {
    const clip = await ctx.db.audioClip.findUnique({ where: { id: req.params.id } });
    if (!clip) return reply.code(404).send({ error: "Not found" });
    return publicClip(clip, (k) => ctx.storage.publicPath(k), ctx.readSessionId(req));
  });

  app.get("/api/sounds", async () =>
    soundLibrary().sounds.map((s) => ({ id: s.id, label: s.label, url: `/sounds/${s.file}`, seconds: s.seconds ?? null, license: s.license, credit: s.credit })),
  );
}

/** Turns layers into files on disk, or explains which sound isn't ready. */
async function resolveLayers(layers: Layer[], ctx: AppContext) {
  const library = soundLibrary();
  const clipIds = layers.flatMap((l) => ("clipId" in l.source ? [l.source.clipId] : []));
  const clips = new Map((await ctx.db.audioClip.findMany({ where: { id: { in: clipIds } } })).map((c) => [c.id, c]));
  const out = [];
  for (const l of layers) {
    let file: string;
    if ("clipId" in l.source) {
      const clip = clips.get(l.source.clipId);
      if (!clip || clip.status !== "succeeded" || !clip.path) return `The sound "${l.label}" isn't ready yet. Wait for it, or remove it.`;
      file = ctx.storage.absolutePath(clip.path);
    } else {
      const id = l.source.sound;
      const sound = library.sounds.find((s) => s.id === id);
      if (!sound) return `The library sound "${l.label}" is no longer available. Remove it and export again.`;
      file = path.join(library.dir, sound.file);
    }
    out.push({ file, start: l.start, length: l.length, volume: l.volume, loop: l.loop });
  }
  return out;
}
