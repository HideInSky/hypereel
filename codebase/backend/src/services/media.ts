// Reading and assembling media for stories with the bundled ffmpeg: clip length and
// size, first and last frames, a clip's own audio, and the final export.
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { run, withTempDir } from "./transcode.js";

const ffmpegPath = ffmpegStatic as unknown as string | null;

export interface MediaInfo {
  seconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

/** ffmpeg-static ships no ffprobe, so read the summary ffmpeg prints for an input. */
export function probe(file: string): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg binary not available on this platform"));
    const child = spawn(ffmpegPath, ["-hide_banner", "-i", file], { stdio: ["ignore", "ignore", "pipe"] });
    let text = "";
    child.stderr.on("data", (d) => { text += String(d); });
    child.on("error", reject);
    child.on("close", () => {
      const time = /Duration: (\d+):(\d+):([\d.]+)/.exec(text);
      if (!time) return reject(new Error(`Can't read ${path.basename(file)}`));
      const size = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(text);
      resolve({
        seconds: Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]),
        width: size ? Number(size[1]) : 0,
        height: size ? Number(size[2]) : 0,
        hasAudio: /Audio:/.test(text),
      });
    });
  });
}

// Finished files never change, so their details can be remembered.
const probed = new Map<string, Promise<MediaInfo>>();
export function probeCached(file: string): Promise<MediaInfo> {
  let info = probed.get(file);
  if (!info) {
    info = probe(file);
    info.catch(() => probed.delete(file));
    probed.set(file, info);
  }
  return info;
}

/** The first or last frame of a clip, as a JPEG at the clip's own size. */
export async function frame(video: string, which: "first" | "last"): Promise<Uint8Array> {
  return withTempDir(async (dir) => {
    const out = path.join(dir, "frame.jpg");
    await run([...(which === "last" ? ["-sseof", "-0.1"] : []), "-i", video, "-frames:v", "1", "-q:v", "2", out], 30_000);
    return new Uint8Array(await fs.readFile(out));
  });
}

/** A clip's own sound as AAC, or null if it has none. */
export async function extractAudio(video: string): Promise<Uint8Array | null> {
  if (!(await probeCached(video)).hasAudio) return null;
  return withTempDir(async (dir) => {
    const out = path.join(dir, "audio.m4a");
    await run(["-i", video, "-vn", "-c:a", "aac", "-b:a", "160k", out], 60_000);
    return new Uint8Array(await fs.readFile(out));
  });
}

/** The H3 ratio closest to a clip's shape, so new shots match it. */
export function closestRatio(width: number, height: number): string {
  const ratios: [string, number][] = [["9:16", 9 / 16], ["3:4", 3 / 4], ["1:1", 1], ["4:3", 4 / 3], ["16:9", 16 / 9], ["21:9", 21 / 9]];
  const r = width / height;
  return ratios.reduce((best, cur) => (Math.abs(cur[1] - r) < Math.abs(best[1] - r) ? cur : best))[0];
}

export interface StoryLayer {
  file: string;
  start: number;
  /** null: play to the end of the file (or of the video, when looping) */
  length: number | null;
  volume: number;
  loop: boolean;
}

/**
 * Joins the shots into one video at the first shot's size. With no sound layers, each
 * shot keeps its own sound. With layers, the shots' own sound is muted and the layers
 * are mixed on top, each at its own start time, length and volume.
 */
// Exports are CPU-heavy. One at a time keeps a small server responsive; the rest wait.
let exportQueue: Promise<unknown> = Promise.resolve();
export function renderStory(input: { shots: string[]; layers: StoryLayer[]; width: number; height: number }): Promise<Uint8Array> {
  const next = exportQueue.then(() => renderStoryNow(input));
  exportQueue = next.catch(() => {});
  return next;
}

async function renderStoryNow(input: { shots: string[]; layers: StoryLayer[]; width: number; height: number }): Promise<Uint8Array> {
  const infos = await Promise.all(input.shots.map(probeCached));
  const total = infos.reduce((n, i) => n + i.seconds, 0);
  const { width: w, height: h } = input;
  const args: string[] = [];
  const filters: string[] = [];

  input.shots.forEach((file, i) => {
    args.push("-i", file);
    filters.push(`[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=24,format=yuv420p[v${i}]`);
    if (input.layers.length === 0) {
      // Pad or cut each clip's sound to its picture, so later clips stay in sync.
      const seconds = infos[i]!.seconds.toFixed(3);
      filters.push(infos[i]!.hasAudio
        ? `[${i}:a]aresample=44100,aformat=channel_layouts=stereo,apad,atrim=duration=${seconds}[a${i}]`
        : `anullsrc=r=44100:cl=stereo,atrim=duration=${seconds}[a${i}]`);
    }
  });
  const n = input.shots.length;
  filters.push(`${input.shots.map((_, i) => `[v${i}]`).join("")}concat=n=${n}:v=1:a=0[vout]`);

  // Layers that start after the video ends would be silent anyway (and atrim=0 means "no limit").
  const audible = input.layers.filter((l) => total - l.start > 0.05);
  if (audible.length === 0) {
    filters.push(input.layers.length === 0
      ? `${input.shots.map((_, i) => `[a${i}]`).join("")}concat=n=${n}:v=0:a=1[aout]`
      : `anullsrc=r=44100:cl=stereo,atrim=duration=${total.toFixed(3)}[aout]`);
  } else {
    const lengths = await Promise.all(audible.map((l) => probeCached(l.file).then((i) => i.seconds)));
    audible.forEach((layer, j) => {
      const idx = n + j;
      args.push("-i", layer.file);
      const room = total - layer.start;
      const length = Math.min(layer.length ?? room, room);
      const delay = Math.round(layer.start * 1000);
      // Loop in the filter: -stream_loop deadlocks the bundled ffmpeg when mixing several inputs.
      const loop = layer.loop ? `,aloop=loop=-1:size=${Math.ceil(Math.max(0.1, lengths[j]!) * 44100)}` : "";
      filters.push(`[${idx}:a]aresample=44100,aformat=channel_layouts=stereo${loop},atrim=duration=${length.toFixed(3)},asetpts=PTS-STARTPTS,volume=${layer.volume.toFixed(2)},adelay=${delay}|${delay}[l${j}]`);
    });
    // A silent bed sets the length, so the mix always covers the whole video.
    filters.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${total.toFixed(3)}[bed]`);
    filters.push(`[bed]${audible.map((_, j) => `[l${j}]`).join("")}amix=inputs=${audible.length + 1}:duration=first:normalize=0,alimiter=limit=0.95[aout]`);
  }

  return withTempDir(async (dir) => {
    const out = path.join(dir, "story.mp4");
    await run([...args, "-filter_complex", filters.join(";"), "-map", "[vout]", "-map", "[aout]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-maxrate", "2500k", "-bufsize", "5000k",
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-threads", "2", "-t", total.toFixed(3), out], 300_000);
    return new Uint8Array(await fs.readFile(out));
  });
}
