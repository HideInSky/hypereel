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
  /** Returns this visitor's session id, creating the cookie if needed. */
  getSessionId: (req: FastifyRequest, reply: FastifyReply) => string;
  /** Returns the session id if there is a valid cookie. Never sets one. */
  readSessionId: (req: FastifyRequest) => string | null;
  clientIp: (req: FastifyRequest) => string;
}

declare module "fastify" {
  interface FastifyInstance {
    storage: Storage;
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));

export async function buildApp(opts: { cfg: Config; db: PrismaClient; provider: VideoProvider; storage?: Storage }) {
  const { cfg, db, provider } = opts;
  const storage = opts.storage ?? new LocalStorage(cfg.DATA_DIR);
  if (storage instanceof LocalStorage) await storage.init();

  const app = Fastify({
    logger: cfg.NODE_ENV !== "test",
    bodyLimit: cfg.MAX_UPLOAD_MB * 1024 * 1024,
  });

  await app.register(cookie, { secret: cfg.COOKIE_SECRET });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(multipart, { limits: { fileSize: cfg.MAX_UPLOAD_MB * 1024 * 1024, files: 9 } }); // 9 = most images the H3 reference node accepts

  // Anonymous session: a signed random id in a cookie. No accounts, no friction.
  const readSessionId = (req: FastifyRequest): string | null => {
    const raw = req.cookies["tz_session"];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    return unsigned?.valid && unsigned.value ? unsigned.value : null;
  };
  const getSessionId = (req: FastifyRequest, reply: FastifyReply): string => {
    const existing = readSessionId(req);
    if (existing) return existing;
    const id = randomBytes(16).toString("hex");
    reply.setCookie("tz_session", id, {
      signed: true, httpOnly: true, sameSite: "lax", path: "/",
      secure: cfg.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365,
    });
    return id;
  };

  // Rate limits need the real client IP. X-Forwarded-For can't be used: its first
  // entry is whatever the client sent. See CLIENT_IP_HEADER in config.ts.
  const clientIp = (req: FastifyRequest): string => {
    const header = cfg.CLIENT_IP_HEADER ? req.headers[cfg.CLIENT_IP_HEADER.toLowerCase()] : undefined;
    const value = Array.isArray(header) ? header[0] : header;
    return value?.trim() || req.ip;
  };

  const ctx: AppContext = { cfg, db, provider, storage, getSessionId, readSessionId, clientIp };

  // Uploaded photos and rendered videos.
  await app.register(fastifyStatic, {
    root: path.resolve(cfg.DATA_DIR, "media"),
    prefix: "/media/",
    decorateReply: false,
    cacheControl: true,
    maxAge: "7d",
    immutable: true,
  });

  app.decorate("storage", storage);

  await generationRoutes(app, ctx);
  await shareRoutes(app, ctx);

  // In production the backend also serves the built frontend (one container,
  // one URL). In dev, Vite serves it on :5173 and proxies /api here.
  const frontendDist = path.resolve(here, "../../frontend/dist");
  if (existsSync(frontendDist)) {
    await app.register(fastifyStatic, {
      root: frontendDist,
      prefix: "/",
      decorateReply: true,
      wildcard: false,
      cacheControl: false, // set per file type below
      setHeaders: (res, filePath) => {
        // Hashed build files never change. Example clips rarely do. index.html must stay fresh.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) res.header("Cache-Control", "public, max-age=31536000, immutable");
        else if (filePath.includes(`${path.sep}effects${path.sep}`)) res.header("Cache-Control", "public, max-age=86400");
        else res.header("Cache-Control", "no-cache");
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith("/api/") || req.raw.url?.startsWith("/media/")) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html"); // SPA fallback
    });
  }

  return app;
}
