// Builds the Fastify app without listening, so tests can inject a fake
// provider and an isolated DB. `server.ts` is the thin production entry.
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";
import type { VideoProvider } from "./services/comfy.js";
import { LocalStorage, type Storage } from "./services/storage.js";
import { generationRoutes } from "./routes/generations.js";
import { shareRoutes } from "./routes/share.js";

export interface AppContext {
  cfg: Config;
  db: PrismaClient;
  provider: VideoProvider;
  storage: Storage;
  getSessionId: (req: FastifyRequest, reply: FastifyReply) => string;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export async function buildApp(opts: { cfg: Config; db: PrismaClient; provider: VideoProvider; storage?: Storage }) {
  const { cfg, db, provider } = opts;
  const storage = opts.storage ?? new LocalStorage(cfg.DATA_DIR);
  if (storage instanceof LocalStorage) await storage.init();

  const app = Fastify({
    logger: cfg.NODE_ENV !== "test",
    trustProxy: true, // Railway/any reverse proxy: get the real client IP for rate limits
    bodyLimit: cfg.MAX_UPLOAD_MB * 1024 * 1024,
  });

  await app.register(cookie, { secret: cfg.COOKIE_SECRET });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(multipart, { limits: { fileSize: cfg.MAX_UPLOAD_MB * 1024 * 1024, files: 9 } }); // 9 = most images the H3 reference node accepts

  // Anonymous session: a signed random id in a cookie. No accounts, no friction.
  const getSessionId = (req: FastifyRequest, reply: FastifyReply): string => {
    const raw = req.cookies["tz_session"];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    if (unsigned?.valid && unsigned.value) return unsigned.value;
    const id = randomBytes(16).toString("hex");
    reply.setCookie("tz_session", id, {
      signed: true, httpOnly: true, sameSite: "lax", path: "/",
      secure: cfg.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365,
    });
    return id;
  };

  const ctx: AppContext = { cfg, db, provider, storage, getSessionId };

  // Uploaded photos and rendered videos.
  await app.register(fastifyStatic, {
    root: path.resolve(cfg.DATA_DIR, "media"),
    prefix: "/media/",
    decorateReply: false,
    cacheControl: true,
    maxAge: "7d",
    immutable: true,
  });

  await generationRoutes(app, ctx);
  await shareRoutes(app, ctx);

  // In production the backend also serves the built frontend (one container,
  // one URL). In dev, Vite serves it on :5173 and proxies /api here.
  const frontendDist = path.resolve(here, "../../frontend/dist");
  if (existsSync(frontendDist)) {
    await app.register(fastifyStatic, { root: frontendDist, prefix: "/", decorateReply: true, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith("/api/") || req.raw.url?.startsWith("/media/")) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html"); // SPA fallback
    });
  }

  return app;
}
