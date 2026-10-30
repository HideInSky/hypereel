// Re-encodes video for smooth web playback. The model's clips run 6-9 Mbps at 480P,
// about 6x more than that picture needs, so a slower connection keeps stalling.
// Uses the ffmpeg binary from the ffmpeg-static npm package: nothing to install on the host.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

// The package's type declaration doesn't match how it exports under ESM; it's a path or null.
const ffmpegPath = ffmpegStatic as unknown as string | null;

// +faststart puts the index at the front of the file, so playback can begin before
// the whole file has downloaded. yuv420p and H.264 play in every browser.
const COMMON = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-threads", "2"];

/** For the player: same picture size, far lower bitrate, audio kept. */
const PLAYBACK = [...COMMON, "-preset", "veryfast", "-crf", "23", "-maxrate", "1800k", "-bufsize", "3600k", "-c:a", "copy"];
/** For gallery tiles: small, silent, and with a steady bitrate so many can play at once. */
const GALLERY = [...COMMON, "-vf", "scale=360:-2", "-preset", "slow", "-crf", "28", "-maxrate", "800k", "-bufsize", "1600k", "-an"];

function run(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg binary not available on this platform"));
    const child = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += String(d); });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = path.join(os.tmpdir(), `hypereel-${randomBytes(6).toString("hex")}`);
  await fs.mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Encodes a clip for playback. Throws if ffmpeg fails, so callers can keep the original. */
export async function toPlayback(video: Uint8Array): Promise<Uint8Array> {
  return withTempDir(async (dir) => {
    const input = path.join(dir, "in.mp4");
    const output = path.join(dir, "out.mp4");
    await fs.writeFile(input, video);
    await run(["-i", input, ...PLAYBACK, output], 120_000);
    return new Uint8Array(await fs.readFile(output));
  });
}

/** Writes a gallery clip and a poster image from one source clip. */
export async function toGalleryClip(video: Uint8Array, clipPath: string, posterPath: string): Promise<void> {
  await withTempDir(async (dir) => {
    const input = path.join(dir, "in.mp4");
    await fs.writeFile(input, video);
    await run(["-i", input, ...GALLERY, clipPath], 180_000);
    await run(["-ss", "0.3", "-i", clipPath, "-frames:v", "1", "-q:v", "5", posterPath], 30_000);
  });
}
