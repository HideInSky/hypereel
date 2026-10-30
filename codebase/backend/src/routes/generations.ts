import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EFFECTS, EFFECT_IDS, getEffect, previewUrl, sanitizeUserPrompt, type ReferenceRole } from "../effects.js";
import { checkLimits } from "../services/limits.js";
import { LimitExceededError, createGeneration, type UploadedReference } from "../services/generator.js";
import type { AppContext } from "../app.js";
import type { Generation } from "@prisma/client";

export const RESOLUTIONS = ["480P", "768P"] as const;
export const ASPECT_RATIOS = ["9:16", "3:4", "1:1", "16:9"] as const;
/** Per-role caps. They add up to 9, the most images the H3 reference node accepts. */
export const ROLE_LIMITS: Record<ReferenceRole, number> = { character: 4, location: 2, product: 3 };
const ROLES = Object.keys(ROLE_LIMITS) as ReferenceRole[];

const createSchema = z.object({
  effect: z.enum(EFFECT_IDS as [string, ...string[]]),
  prompt: z.string().max(300).optional(),
  resolution: z.enum(RESOLUTIONS).default("480P"),
  aspectRatio: z.enum(ASPECT_RATIOS).default("9:16"),
});

/**
 * What the API returns for a clip. A share link goes to anyone, so only the clip's
 * owner sees the photo they uploaded and the note they wrote. The finished video is
 * what they chose to share; their source photos are not.
 */
export function toPublic(g: Generation, ctx: AppContext, viewerSessionId: string | null) {
  const isOwner = viewerSessionId !== null && viewerSessionId === g.sessionId;
  return {
    id: g.id,
    status: g.status,
    progress: g.progress,
    effect: g.genre,
    effectLabel: getEffect(g.genre)?.label ?? "hypereel",
    prompt: isOwner ? g.caption : null,
    model: g.model,
    resolution: g.resolution,
    aspectRatio: g.aspectRatio,
    error: g.status === "failed" ? g.error : null,
    videoUrl: g.videoPath ? ctx.storage.publicPath(g.videoPath) : null,
    posterUrl: isOwner && g.posterPath ? ctx.storage.publicPath(g.posterPath) : null,
    shareUrl: `${ctx.cfg.PUBLIC_URL}/v/${g.id}`,
    createdAt: g.createdAt,
  };
}

export async function generationRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/effects", async () =>
    EFFECTS.map(({ id, label, description, seconds }) => ({ id, label, description, seconds, preview: previewUrl(id) })),
  );

  app.post("/api/generations", async (req, reply) => {
    const uploads: Record<ReferenceRole, Uint8Array[]> = { character: [], location: [], product: [] };
    const fields: Record<string, string> = {};
    for await (const part of req.parts()) {
      if (part.type === "file") {
        const bytes = new Uint8Array(await part.toBuffer());
        if (ROLES.includes(part.fieldname as ReferenceRole) && bytes.length > 0) uploads[part.fieldname as ReferenceRole].push(bytes);
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
    const parsed = createSchema.safeParse(fields);
    if (!parsed.success) return reply.code(400).send({ error: "Pick a valid effect, resolution and aspect ratio." });
    if (uploads.character.length === 0) return reply.code(400).send({ error: "Add at least one character photo." });
    for (const role of ROLES) {
      if (uploads[role].length > ROLE_LIMITS[role]) {
        return reply.code(400).send({ error: `Too many ${role} photos. The limit is ${ROLE_LIMITS[role]}.` });
      }
    }

    const sessionId = ctx.getSessionId(req, reply);
    const ip = ctx.clientIp(req);
    // A cheap early exit, so over-limit visitors don't cost any image processing.
    // createGeneration repeats this check atomically, and that one is the real guard.
    const limit = await checkLimits(ctx.db, ctx.cfg, { sessionId, ip });
    if (!limit.ok) return reply.code(429).send({ error: limit.message, reason: limit.reason });

    // Fixed order so the prompt's "Image 1, Image 2..." always lines up with the node inputs.
    const references: UploadedReference[] = ROLES.flatMap((role) => uploads[role].map((bytes) => ({ role, bytes })));
    try {
      const row = await createGeneration(
        { db: ctx.db, provider: ctx.provider, storage: ctx.storage, cfg: ctx.cfg, log: app.log },
        {
          effect: parsed.data.effect,
          references,
          userPrompt: sanitizeUserPrompt(parsed.data.prompt),
          resolution: parsed.data.resolution,
          aspectRatio: parsed.data.aspectRatio,
          sessionId,
          ip,
        },
      );
      return reply.code(202).send(toPublic(row, ctx, sessionId));
    } catch (err) {
      if (err instanceof LimitExceededError) return reply.code(429).send({ error: err.message, reason: err.reason });
      app.log.warn({ err }, "bad upload");
      return reply.code(400).send({ error: "One of those images couldn't be read. Try a JPG or PNG." });
    }
  });

  app.get<{ Params: { id: string } }>("/api/generations/:id", async (req, reply) => {
    const g = await ctx.db.generation.findUnique({ where: { id: req.params.id } });
    if (!g) return reply.code(404).send({ error: "Not found" });
    return toPublic(g, ctx, ctx.readSessionId(req));
  });

  // This visitor's own clips, for the History tab. Identified by the signed session cookie.
  app.get("/api/history", async (req, reply) => {
    const sessionId = ctx.getSessionId(req, reply);
    const rows = await ctx.db.generation.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rows.map((g) => toPublic(g, ctx, sessionId));
  });

  app.get("/api/health", async () => ({ ok: true, provider: ctx.provider.name }));
}
