import { PrismaClient } from "@prisma/client";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/app.js";
import type { VideoProvider } from "../src/services/comfy.js";

export const db = new PrismaClient();

/** A provider that returns fixed bytes instantly, or fails on demand. */
export function stubProvider(opts: { fail?: boolean } = {}): VideoProvider {
  return {
    name: "stub",
    promptKind: "brief",
    async generate(input) {
      input.onProgress?.(50);
      if (opts.fail) throw new Error("boom");
      return { video: new TextEncoder().encode("not-really-mp4"), mime: "video/mp4", jobId: "job-1", model: "stub", script: "A test scene." };
    },
  };
}

export async function testApp(overrides: Partial<NodeJS.ProcessEnv> = {}, provider = stubProvider()) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "hypereel-data-"));
  const cfg = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: process.env.DATABASE_URL,
    DATA_DIR: dataDir,
    PUBLIC_URL: "http://test.local",
    COMFY_MODE: "fake",
    ...overrides,
  });
  const app = await buildApp({ cfg, db, provider });
  return { app, cfg, dataDir };
}

export async function tinyJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: "#ff3d71" } }).jpeg().toBuffer();
}

/** Multipart body builder (no extra deps). */
export function multipart(fields: Record<string, string>, file?: { name: string; data: Buffer; filename: string }) {
  const boundary = "----hypereel" + Math.random().toString(36).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: image/jpeg\r\n\r\n`));
    parts.push(file.data, Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

export async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timeout");
}
