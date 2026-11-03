// Adds downloaded sounds to the story sound library (frontend/public/sounds). Each file
// is cut to at most 60 s, loudness-matched, faded at both ends and saved as MP3, and an
// entry with its credit goes into library.json. Freesound names files
// "<id>__<author>__<title>.<ext>", which gives the source page and the credit for free.
//   npm run import-sounds -- ~/Downloads/hypereel-sounds --license CC0
// Only import sounds you may redistribute in an MIT repo (CC0 is the safe choice).
import { spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegStatic from "ffmpeg-static";
import { probe } from "../src/services/media.js";

const ffmpeg = ffmpegStatic as unknown as string;
const args = process.argv.slice(2);
const licenseAt = args.indexOf("--license");
const license = licenseAt >= 0 ? args[licenseAt + 1] : undefined;
const folder = args.find((a, i) => !a.startsWith("--") && i !== licenseAt + 1);
if (!folder || !license) {
  console.error("Usage: npm run import-sounds -- <folder> --license CC0");
  process.exit(1);
}

const outDir = fileURLToPath(new URL("../../frontend/public/sounds/", import.meta.url));
const listFile = path.join(outDir, "library.json");
type Entry = { id: string; label: string; file: string; seconds: number; license: string; credit: string; source: string };
const list: Entry[] = existsSync(listFile) ? JSON.parse(await fs.readFile(listFile, "utf8")) : [];

const slug = (t: string) => t.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "sound";
const title = (t: string) => {
  const words = t.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 40);
};

const files = (await fs.readdir(folder)).filter((f) => /\.(wav|mp3|ogg|flac|aiff?|m4a)$/i.test(f)).sort();
for (const name of files) {
  const freesound = /^(\d+)__([^_]+(?:_[^_]+)*)__(.+)$/.exec(name);
  const label = title(freesound ? freesound[3]! : name);
  let id = slug(label);
  while (list.some((e) => e.id === id)) id = `${id}-2`;
  const file = `${id}.mp3`;
  const src = path.join(folder, name);
  const run = spawnSync(ffmpeg, [
    "-y", "-loglevel", "error", "-i", src, "-t", "60", "-vn",
    "-af", "loudnorm=I=-20:TP=-2:LRA=11,afade=t=in:d=0.05,areverse,afade=t=in:d=0.05,areverse",
    "-ac", "2", "-ar", "44100", "-b:a", "128k", path.join(outDir, file),
  ]);
  if (run.status !== 0) {
    console.error(`skipped ${name}: ${run.stderr.toString().trim()}`);
    continue;
  }
  const seconds = Math.round((await probe(path.join(outDir, file))).seconds * 10) / 10;
  list.push({
    id, label, file, seconds, license,
    credit: freesound ? freesound[2]! : "",
    source: freesound ? `https://freesound.org/s/${freesound[1]}/` : "",
  });
  console.log(`ok ${file} (${seconds}s) ${label}`);
}
await fs.writeFile(listFile, `${JSON.stringify(list, null, 2)}\n`);
console.log(`library.json now lists ${list.length} sounds. Check the labels, then commit.`);
