// Renders the gallery's opening clips, each with a different invented person and scene.
// Every step costs real credits, so the two are separate and you can check the photos first:
//   npm run showcase -- --refs          makes the reference photos (Nano Banana 2)
//   npm run showcase -- --clips [ids]   renders clips from those photos (MiniMax H3)
import { existsSync, promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
import { Comfy } from "@comfyorg/sdk";
import sharp from "sharp";
import { loadConfig } from "../src/config.js";
import { createProvider } from "../src/services/comfy.js";
import { buildEffectPrompt, getEffect } from "../src/effects.js";
import { PREVIEWS } from "../src/previews.js";
import { SHOWCASE } from "../src/showcase.js";
import { toGalleryClip } from "../src/services/transcode.js";

const INVENTED = "Entirely invented person, not resembling anyone real. No logos, no brand names, no readable text.";

const PHOTO_LOOK = "35mm film look, sharp focus.";

const CAST: Record<string, { photo: string; direction: string; look?: string }> = {
  canvas: {
    photo: "Candid three-quarter back view of a fictional athletic man in his 20s in a sleeveless white tank top and black shorts, on a steep colorful hillside neighbourhood street with tangled power lines, parked motorbikes and market stalls, harsh tropical sun.",
    direction: "The character jogs up the busy street, then looks back over one shoulder at the camera.",
  },
  comic: {
    photo: "Moody full-body photo of a fictional woman in her 30s with a short silver bob and a long dark trench coat, in a narrow rainy alley at night lit by coloured lamps, wet cobblestones.",
    direction: "The character strides through the rain with the coat swinging, then turns sharply to face the camera.",
  },
  particles: {
    photo: "Full-body photo of a fictional contemporary dancer, a slim man in his 20s in loose black clothes, mid-pose in a vast dark empty warehouse with shafts of light through high windows.",
    direction: "The character performs one slow flowing spin with arms extended.",
  },
  windows: {
    photo: "Flash photo of a fictional young woman in her 20s with long black hair, a silver metallic puffer jacket and low-rise cargo pants, holding an unbranded retro flip phone, on an escalator in an early-2000s shopping mall.",
    direction: "The character talks on the flip phone, laughs and flicks their hair while riding the escalator.",
  },
  palette: {
    photo: "Low-angle portrait of a fictional man in his 50s with a beanie, white wide-frame sunglasses and a baggy khaki field jacket, a big unbranded silver boombox on one shoulder, in a brick tenement alley at dusk with warm lit windows above.",
    direction: "The character walks slowly toward the camera, nodding to the music with the boombox on one shoulder.",
    // H3 follows a photo's realism over the prompt, so this one starts from a painting.
    look: "Painted entirely in thick impasto oil paint on canvas, with heavy visible brushstrokes on the face, clothes and background, and no photographic detail anywhere.",
  },
  lsd: {
    photo: "Flash photo of a fictional young woman in her 20s in an oversized white t-shirt and a dark cap, grinning and leaning against the snack shelves of a fluorescent-lit convenience store at night. Shelf packaging is blank and unbranded.",
    direction: "The character laughs and sways, leaning against the shelves in the convenience store.",
  },
  tracking: {
    photo: "Full-body action photo of a fictional skateboarder, a young Black man in a grey hoodie and loose jeans, riding a concrete skate park under an overcast sky.",
    direction: "The character carves across the concrete on the skateboard and pops a small jump.",
  },
  "stop-world": {
    photo: "Full-body street photo of a fictional woman in her 40s in a bright orange tailored suit, standing in the middle of a crowded downtown crosswalk with pigeons on the ground and tall buildings behind. Cars and signs are unbranded.",
    direction: "It happens on the crowded crosswalk, and a flock of pigeons takes off just before the character snaps their fingers.",
  },
  lidar: {
    photo: "Full-body photo of a fictional woman in her 30s, a mountain hiker in a red shell jacket with a backpack, standing on a rocky alpine ridge at dawn with snowy peaks behind.",
    direction: "The new environment is a huge field of white lilies swaying under a deep blue sky.",
  },
};

const refPath = (id: string) => new URL(`./preview-refs/showcase/${id}.jpg`, import.meta.url);
const args = process.argv.slice(2);
const named = args.filter((a) => !a.startsWith("--"));
const ids = Object.keys(SHOWCASE).filter((id) => named.length === 0 || named.includes(id));

// A few at a time: renders are slow, but the service is fine with some parallelism.
async function eachLimited(items: string[], fn: (id: string) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        await fn(id);
        console.log(`ok ${id}`);
      } catch (err) {
        console.error(`FAILED ${id}: ${(err as Error).message}`);
      }
    }
  }));
}

if (args.includes("--refs")) {
  const key = process.env.COMFY_API_KEY!;
  const client = new Comfy({ apiKey: key });
  await fs.mkdir(new URL("./preview-refs/showcase/", import.meta.url), { recursive: true });
  await eachLimited(ids, async (id) => {
    const wf = client.workflows.fromJson({
      "1": { class_type: "GeminiNanoBanana2", inputs: { prompt: `${CAST[id]!.photo} ${CAST[id]!.look ?? PHOTO_LOOK} ${INVENTED}`, model: "Nano Banana 2 (Gemini 3.1 Flash Image)", seed: Math.floor(Math.random() * 1e9), aspect_ratio: SHOWCASE[id], resolution: "1K", response_modalities: "IMAGE", thinking_level: "MINIMAL" } },
      "2": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: id } },
    } as never);
    const job = await client.submit(wf, { apiKey: key });
    await job.result();
    const png = await job.getOutputs("2")[0]!.toBytes();
    await fs.writeFile(refPath(id), await sharp(png).resize({ width: 1024, height: 1024, fit: "inside" }).jpeg({ quality: 88 }).toBuffer());
  });
} else if (args.includes("--clips")) {
  const seconds = ids.reduce((n, id) => n + getEffect(id)!.seconds, 0);
  console.log(`Rendering ${ids.length} clips, ${seconds}s in total, about $${(seconds * 0.0715).toFixed(2)}.`);
  const provider = createProvider(loadConfig({ ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://unused" }));
  const outDir = new URL("../../frontend/public/effects/", import.meta.url);
  const done: string[] = [];
  await eachLimited(ids, async (id) => {
    const effect = getEffect(id)!;
    const out = await provider.generate({
      references: [new Uint8Array(await fs.readFile(refPath(id)))],
      prompt: buildEffectPrompt(id, [{ role: "character" }], CAST[id]!.direction),
      seconds: effect.seconds, resolution: "480P", aspectRatio: SHOWCASE[id]!,
    });
    await toGalleryClip(out.video, fileURLToPath(new URL(`${id}.mp4`, outDir)), fileURLToPath(new URL(`${id}.jpg`, outDir)));
    done.push(id);
  });
  const all = [...PREVIEWS, ...done.filter((id) => !PREVIEWS.includes(id))];
  await fs.writeFile(new URL("../src/previews.ts", import.meta.url),
    `// Effects with a rendered example clip in frontend/public/effects/<id>.mp4.\n// Maintained by scripts/render-previews.ts.\nexport const PREVIEWS: string[] = ${JSON.stringify(all)};\n`);
} else {
  console.error("Say --refs or --clips.");
  process.exit(1);
}
