import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { GENRES, GENRE_IDS, sanitizeCaption } from "../prompts.js";
import { checkLimits } from "../services/limits.js";
import { createGeneration } from "../services/generator.js";
import type { AppContext } from "../app.js";
import type { Generation } from "@prisma/client";

const createSchema = z.object({
  genre: z.enum(GENRE_IDS as [string, ...string[]]),
  caption: z.string().max(120).optional(),
});

export function toPublic(g: Generation, ctx: AppContext) {
  return {
    id: g.id,
    status: g.status,
    progress: g.progress,
    genre: g.genre,
    caption: g.caption,
    model: g.model,
    script: g.script,
    error: g.status === "failed" ? g.error : null,
    videoUrl: g.videoPath ? ctx.storage.publicPath(g.videoPath) : null,
    posterUrl: g.posterPath ? ctx.storage.publicPath(g.posterPath) : null,
    shareUrl: `${ctx.cfg.PUBLIC_URL}/v/${g.id}`,
    createdAt: g.createdAt,
  };
}

export async function generationRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/genres", async () => GENRES.map(({ id, label, emoji, tagline }) => ({ id, label, emoji, tagline })));

  app.post("/api/generations", async (req, reply) => {
    const parts = req.parts();
    let imageBytes: Uint8Array | undefined;
    const fields: Record<string, string> = {};
    for await (const part of parts) {
      if (part.type === "file") {
        if (part.fieldname !== "image") { part.file.resume(); continue; }
        imageBytes = new Uint8Array(await part.toBuffer());
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
    if (!imageBytes || imageBytes.length === 0) return reply.code(400).send({ error: "Please upload a photo." });
    const parsed = createSchema.safeParse(fields);
    if (!parsed.success) return reply.code(400).send({ error: "Pick a valid genre." });

    const sessionId = ctx.getSessionId(req, reply);
    const ip = req.ip;
    const limit = await checkLimits(ctx.db, ctx.cfg, { sessionId, ip });
    if (!limit.ok) return reply.code(429).send({ error: limit.message, reason: limit.reason });

    try {
      const row = await createGeneration(
        { db: ctx.db, provider: ctx.provider, storage: ctx.storage, cfg: ctx.cfg, log: app.log },
        { imageBytes, genre: parsed.data.genre, caption: sanitizeCaption(parsed.data.caption), sessionId, ip },
      );
      return reply.code(202).send(toPublic(row, ctx));
    } catch (err) {
      app.log.warn({ err }, "bad upload");
      return reply.code(400).send({ error: "That image couldn't be read. Try a JPG or PNG." });
    }
  });

  app.get<{ Params: { id: string } }>("/api/generations/:id", async (req, reply) => {
    const g = await ctx.db.generation.findUnique({ where: { id: req.params.id } });
    if (!g) return reply.code(404).send({ error: "Not found" });
    return toPublic(g, ctx);
  });

  // Recent successful clips for the landing-page gallery (the "feed" that makes it feel alive).
  app.get("/api/feed", async () => {
    const rows = await ctx.db.generation.findMany({
      where: { status: "succeeded" },
      orderBy: { createdAt: "desc" },
      take: 24,
    });
    return rows.map((g) => toPublic(g, ctx));
  });

  app.get("/api/health", async () => ({ ok: true, provider: ctx.provider.name }));
}
