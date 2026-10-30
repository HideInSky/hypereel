// Renders example clips for effects that don't have one yet. Every clip costs real
// credits, so you must name the effects, or pass --all together with --max:
//   npm run previews -- melting earth-zoom
//   npm run previews -- --all --max 10
// Uses invented people and products from scripts/preview-refs, so the example clips
// contain no third-party footage or real likenesses.
import { existsSync, promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
import { loadConfig } from "../src/config.js";
import { createProvider } from "../src/services/comfy.js";
import { EFFECTS, buildEffectPrompt } from "../src/effects.js";
import { PREVIEWS } from "../src/previews.js";
import { toGalleryClip } from "../src/services/transcode.js";

const args = process.argv.slice(2);
const maxAt = args.indexOf("--max");
const max = maxAt >= 0 ? Number(args[maxAt + 1]) : Infinity;
const named = args.filter((a, i) => !a.startsWith("--") && (maxAt < 0 || i !== maxAt + 1));
const missing = EFFECTS.filter((e) => !PREVIEWS.includes(e.id));
if (args.includes("--all") && !Number.isFinite(max)) { console.error("--all needs --max N, so a typo can't spend every credit."); process.exit(1); }
const todo = (args.includes("--all") ? missing : missing.filter((e) => named.includes(e.id))).slice(0, max);
if (todo.length === 0) { console.error(`Nothing to do. Missing: ${missing.map((e) => e.id).join(" ")}`); process.exit(1); }

const USD_PER_SECOND_480P = 0.0715;
const seconds = todo.reduce((n, e) => n + e.seconds, 0);
console.log(`Rendering ${todo.length} clips, ${seconds}s in total, about $${(seconds * USD_PER_SECOND_480P).toFixed(2)}.`);

const cfg = loadConfig({ ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://unused" });
const provider = createProvider(cfg);
const refDir = new URL("./preview-refs/", import.meta.url);
const character = new Uint8Array(await fs.readFile(new URL("character.jpg", refDir)));
const product = new Uint8Array(await fs.readFile(new URL("product.jpg", refDir)));
const outDir = new URL("../../frontend/public/effects/", import.meta.url);

// A few at a time: renders are slow, but the service is fine with some parallelism.
const done: string[] = [];
const queue = [...todo];
await Promise.all(Array.from({ length: 3 }, async () => {
  for (let e = queue.shift(); e; e = queue.shift()) {
    try {
      const refs = [{ role: "character" as const }, { role: "product" as const }];
      const out = await provider.generate({
        references: [character, product],
        prompt: buildEffectPrompt(e.id, refs),
        seconds: e.seconds, resolution: "480P", aspectRatio: "9:16",
      });
      await toGalleryClip(out.video, fileURLToPath(new URL(`${e.id}.mp4`, outDir)), fileURLToPath(new URL(`${e.id}.jpg`, outDir)));
      done.push(e.id);
      console.log(`ok ${e.id}`);
    } catch (err) {
      console.error(`FAILED ${e.id}: ${(err as Error).message}`);
    }
  }
}));

const all = [...PREVIEWS, ...done];
await fs.writeFile(new URL("../src/previews.ts", import.meta.url),
  `// Effects with a rendered example clip in frontend/public/effects/<id>.mp4.\n// Maintained by scripts/render-previews.ts.\nexport const PREVIEWS: string[] = ${JSON.stringify(all)};\n`);
console.log(`Done: ${done.length} rendered, ${todo.length - done.length} failed.`);
