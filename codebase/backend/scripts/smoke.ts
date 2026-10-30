// End-to-end smoke test of the Comfy/MiniMax H3 path, no server, no DB:
//   npm run smoke -- vanish character:me.jpg location:street.jpg product:phone.jpg
// Writes the video to <effect>.mp4 in the current folder and prints the job id.
// Load ../../.env (repo root) for local dev. In Docker/Railway, real env vars are injected instead.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
import { promises as fs } from "node:fs";
import { loadConfig } from "../src/config.js";
import { createProvider } from "../src/services/comfy.js";
import { buildEffectPrompt, getEffect, type ReferenceRole } from "../src/effects.js";
import { prepareImage } from "../src/services/generator.js";

const [effectId, ...specs] = process.argv.slice(2);
const effect = effectId ? getEffect(effectId) : undefined;
if (!effect || specs.length === 0) { console.error("usage: smoke <effect> character:a.jpg [location:b.jpg] [product:c.jpg]"); process.exit(1); }
const order: ReferenceRole[] = ["character", "location", "product"];
const refs = specs
  .map((s) => { const i = s.indexOf(":"); return { role: s.slice(0, i) as ReferenceRole, file: s.slice(i + 1) }; })
  .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
const cfg = loadConfig({ ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://unused" });
const provider = createProvider(cfg);
const prompt = buildEffectPrompt(effect.id, refs);
console.log(`provider=${provider.name} seconds=${effect.seconds}\nprompt: ${prompt}`);
const t0 = Date.now();
const out = await provider.generate({
  references: await Promise.all(refs.map(async (r) => prepareImage(new Uint8Array(await fs.readFile(r.file))))),
  prompt, seconds: effect.seconds, resolution: process.env.SMOKE_RESOLUTION ?? "480P", aspectRatio: process.env.SMOKE_RATIO ?? "9:16",
  onProgress: (p, note) => console.log(`  ${p}% ${note ?? ""}`),
});
await fs.writeFile(`${effect.id}.mp4`, out.video);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${effect.id}.mp4 (${out.video.length} bytes, job ${out.jobId ?? "n/a"})`);
