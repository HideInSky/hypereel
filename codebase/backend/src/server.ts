// Load ../../.env (repo root) for local dev. In Docker/Railway, real env vars are injected instead.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
import { PrismaClient } from "@prisma/client";
import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { createProvider } from "./services/comfy.js";

const cfg = loadConfig();
const db = new PrismaClient();
const app = await buildApp({ cfg, db, provider: createProvider(cfg) });

app.listen({ port: cfg.PORT, host: cfg.HOST }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => { await app.close(); await db.$disconnect(); process.exit(0); });
}
