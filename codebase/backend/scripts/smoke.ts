// End-to-end smoke test of the Comfy/MiniMax H3 path, no server, no DB:
//   npm run smoke -- path/to/photo.jpg trailer "my cat Mochi"
// Writes the video next to the photo and prints the Comfy job id.
// Load ../../.env (repo root) for local dev. In Docker/Railway, real env vars are injected instead.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
import { promises as fs } from "node:fs";
import { loadConfig } from "../src/config.js";
import { createProvider } from "../src/services/comfy.js";
import { buildPrompt } from "../src/prompts.js";
import { prepareImage } from "../src/services/generator.js";

const [file, genre = "trailer", caption] = process.argv.slice(2);
if (!file) { console.error("usage: smoke <image> [genre] [caption]"); process.exit(1); }
const cfg = loadConfig({ ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://unused" });
const provider = createProvider(cfg);
const { jpeg } = await prepareImage(new Uint8Array(await fs.readFile(file)));
const prompt = buildPrompt(genre, caption);
console.log(`provider=${provider.name} model-mode=${cfg.COMFY_MODE} seconds=${cfg.VIDEO_SECONDS} res=${cfg.VIDEO_RESOLUTION}`);
console.log("prompt:", prompt);
const t0 = Date.now();
const out = await provider.generate({
  imageBytes: jpeg, imageExt: "jpg", prompt, seconds: cfg.VIDEO_SECONDS, resolution: cfg.VIDEO_RESOLUTION,
  onProgress: (p, note) => console.log(`  ${p}% ${note ?? ""}`),
});
const outPath = file.replace(/\.[^.]+$/, "") + `.${genre}.mp4`;
await fs.writeFile(outPath, out.video);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${outPath} (${out.video.length} bytes, job ${out.jobId ?? "n/a"}, model ${out.model})`);
