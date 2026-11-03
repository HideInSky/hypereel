// The ONLY file that knows about Comfy / MiniMax H3. The rest of the app talks
// to `VideoProvider`, so swapping the model or the hosting surface is a
// one-file change (dev-guide rule 1: isolate vendor code behind a thin wrapper).
//
// Two providers:
//  - WorkflowProvider: runs the exported ComfyUI workflow JSON on Comfy Cloud
//    through the official SDK. The same workflow file opens in the ComfyUI editor.
//  - FakeProvider:     offline stub for UI work and tests. Costs nothing.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.js";
import type { Job } from "@comfyorg/sdk";

export interface GenerateInput {
  /** JPEG reference images, in the order the prompt calls "Image 1", "Image 2"... */
  references: Uint8Array[];
  prompt: string;
  seconds: number;
  resolution: string;
  aspectRatio: string;
  onProgress?: (percent: number, note?: string) => void;
  /** Called as soon as the job exists, so a restart can find it again. */
  onJobCreated?: (jobId: string) => Promise<void>;
  signal?: AbortSignal;
}

/** Any ComfyUI graph: files to upload into it, and the node whose output we keep. */
export interface GraphJob {
  graph: Record<string, WorkflowNode>;
  /** [node id, input name, bytes, file name] */
  uploads: [string, string, Uint8Array, string][];
  outputNode: string;
  kind: "video" | "audio" | "image";
  /** For the fake provider: how long the result should be. */
  seconds: number;
  onProgress?: (percent: number, note?: string) => void;
  onJobCreated?: (jobId: string) => Promise<void>;
  signal?: AbortSignal;
}

export interface ResumeInput {
  /** Which node holds the result. Defaults to the effects workflow's SaveVideo. */
  outputNode?: string;
  jobId: string;
  onProgress?: (percent: number, note?: string) => void;
  signal?: AbortSignal;
}

export interface GenerateOutput {
  video: Uint8Array;
  mime: string;
  jobId?: string;
  model: string;
}

export interface VideoProvider {
  readonly name: string;
  generate(input: GenerateInput): Promise<GenerateOutput>;
  /** Runs a graph built by services/workflows.ts (story shots, music, sound effects). */
  runGraph(job: GraphJob): Promise<GenerateOutput>;
  /** Re-attach to a job submitted before a restart, and collect its result. */
  resume(input: ResumeInput): Promise<GenerateOutput>;
}

/** Where the app's inputs go in the workflow (workflows/*_map.json). */
interface WorkflowMap {
  video: string; // node id of the H3 reference node
  prompt: string;
  duration: string;
  resolution: string;
  ratio: string;
  seed: string;
  referencePrefix: string; // e.g. "model.reference_images.image_" + 1, 2, 3...
  output: string; // node id of SaveVideo
  modelLabel: string;
}

type WorkflowNode = { class_type: string; inputs: Record<string, unknown>; _meta?: { title: string } };
type WorkflowGraph = Record<string, WorkflowNode>;

const here = path.dirname(fileURLToPath(import.meta.url));

/** True for dropped connections and DNS blips, which are worth another try. */
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && err.message === "fetch failed";
}

/** Adds the hidden reason ("ECONNRESET" etc.) that Node keeps in err.cause. */
function explain(err: unknown): string {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  const cause = e.cause?.code ?? e.cause?.message;
  return cause ? `${e.message} (${cause})` : e.message;
}

/** Retries only network errors, so real API rejections still fail right away. */
export async function withNetworkRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 1500): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts || !isNetworkError(err)) throw err;
      await new Promise((r) => setTimeout(r, delayMs * i));
    }
  }
}

/**
 * The workflow file holds example LoadImage nodes. Users upload a varying number
 * of images, so swap the examples for one LoadImage per upload, wired in order.
 */
export function withReferenceSlots(graph: WorkflowGraph, map: WorkflowMap, count: number): { graph: WorkflowGraph; loaders: string[] } {
  const next: WorkflowGraph = structuredClone(graph);
  for (const [id, node] of Object.entries(next)) if (node.class_type === "LoadImage") delete next[id];
  const video = next[map.video];
  if (!video) throw new Error(`Workflow has no node ${map.video}`);
  for (const key of Object.keys(video.inputs)) if (key.startsWith(map.referencePrefix)) delete video.inputs[key];
  const loaders: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `ref_${i + 1}`;
    next[id] = { class_type: "LoadImage", inputs: { image: "example.png" } };
    video.inputs[`${map.referencePrefix}${i + 1}`] = [id, 0];
    loaders.push(id);
  }
  return { graph: next, loaders };
}

/** A ready-to-run copy of the workflow for one effect, to open in the ComfyUI editor. */
export async function exportWorkflow(
  cfg: Config,
  input: { prompt: string; seconds: number; resolution: string; aspectRatio: string; imageTitles: string[] },
): Promise<WorkflowGraph> {
  const read = async <T>(p: string) => JSON.parse(await fs.readFile(path.resolve(here, "../..", p), "utf8")) as T;
  const map = await read<WorkflowMap>(cfg.COMFY_WORKFLOW_MAP_PATH);
  const { graph, loaders } = withReferenceSlots(await read<WorkflowGraph>(cfg.COMFY_WORKFLOW_PATH), map, input.imageTitles.length);
  loaders.forEach((id, i) => { graph[id]!._meta = { title: input.imageTitles[i]! }; });
  Object.assign(graph[map.video]!.inputs, {
    [map.prompt]: input.prompt,
    [map.duration]: input.seconds,
    [map.resolution]: input.resolution,
    [map.ratio]: input.aspectRatio,
  });
  return graph;
}

export class WorkflowProvider implements VideoProvider {
  readonly name = "comfy-workflow";
  constructor(private readonly cfg: Config) {}

  private async read<T>(p: string): Promise<T> {
    return JSON.parse(await fs.readFile(path.resolve(here, "../..", p), "utf8")) as T;
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const { Comfy } = await import("@comfyorg/sdk");
    const client = new Comfy({ apiKey: this.cfg.COMFY_API_KEY });

    const map = await this.read<WorkflowMap>(this.cfg.COMFY_WORKFLOW_MAP_PATH);
    const template = await this.read<WorkflowGraph>(this.cfg.COMFY_WORKFLOW_PATH);
    const { graph, loaders } = withReferenceSlots(template, map, input.references.length);

    const wf = client.workflows.fromJson(graph as never);
    // The SDK hashes + uploads each image (dedup-aware) and binds the server-side
    // filename to that LoadImage node's file widget.
    loaders.forEach((id, i) => {
      wf.setInput(id, "image", client.assets.fromBytes(input.references[i]!, { filename: `ref_${i + 1}.jpg` }));
    });
    wf.setInput(map.video, map.prompt, input.prompt);
    wf.setInput(map.video, map.duration, input.seconds);
    wf.setInput(map.video, map.resolution, input.resolution);
    wf.setInput(map.video, map.ratio, input.aspectRatio);
    wf.setInput(map.video, map.seed, Math.floor(Math.random() * 4_294_967_295));

    input.onProgress?.(5, "Submitting to Comfy Cloud");
    // Two different keys, often the same value: the constructor key authenticates
    // US to Comfy Cloud; this one authenticates the partner node (MiniMax H3)
    // INSIDE the workflow and is what gets billed.
    const job = await withNetworkRetry(() => client.submit(wf, { signal: input.signal, apiKey: this.cfg.COMFY_API_KEY }));
    await input.onJobCreated?.(job.id);
    return this.collect(job, map, input);
  }

  async runGraph(input: GraphJob): Promise<GenerateOutput> {
    const { Comfy } = await import("@comfyorg/sdk");
    const client = new Comfy({ apiKey: this.cfg.COMFY_API_KEY });
    const wf = client.workflows.fromJson(input.graph as never);
    for (const [node, name, bytes, filename] of input.uploads) wf.setInput(node, name, client.assets.fromBytes(bytes, { filename }));
    input.onProgress?.(5, "Submitting to Comfy Cloud");
    const job = await withNetworkRetry(() => client.submit(wf, { signal: input.signal, apiKey: this.cfg.COMFY_API_KEY }));
    await input.onJobCreated?.(job.id);
    const map = await this.read<WorkflowMap>(this.cfg.COMFY_WORKFLOW_MAP_PATH);
    return this.collect(job, { ...map, output: input.outputNode }, input);
  }

  async resume(input: ResumeInput): Promise<GenerateOutput> {
    const { Comfy } = await import("@comfyorg/sdk");
    const client = new Comfy({ apiKey: this.cfg.COMFY_API_KEY });
    const map = await this.read<WorkflowMap>(this.cfg.COMFY_WORKFLOW_MAP_PATH);
    const job = await withNetworkRetry(() => client.jobs.get(input.jobId));
    return this.collect(job, input.outputNode ? { ...map, output: input.outputNode } : map, input);
  }

  /** Waits for a submitted job to finish, then downloads the video. */
  private async collect(job: Job, map: Pick<WorkflowMap, "output" | "modelLabel">, input: Pick<GenerateInput, "onProgress" | "signal">): Promise<GenerateOutput> {
    // The event stream only drives the progress bar, so losing it must not lose the
    // (already paid for) job: result() below is what decides success.
    try {
      eventLoop: for await (const ev of job.events(input.signal)) {
        switch (ev.kind) {
          case "progress":
            // Partner nodes report coarse progress; keep the bar moving but honest.
            input.onProgress?.(Math.min(95, Math.max(10, Math.round(ev.value * 100))), ev.message ?? undefined);
            break;
          case "statusChange":
            if (ev.status === "succeeded" || ev.status === "failed" || ev.status === "cancelled") break eventLoop;
            if (ev.queuePosition != null) input.onProgress?.(8, `Queue position ${ev.queuePosition}`);
            break;
        }
      }
    } catch (err) {
      if (!isNetworkError(err)) throw err;
    }
    // result() waits for a terminal state and throws JobFailed unless it succeeded
    // (wait() alone does NOT throw on failure).
    try {
      await withNetworkRetry(() => job.result(input.signal), 5);
    } catch (err) {
      const detail = job.error ? JSON.stringify(job.error).slice(0, 400) : "";
      throw new Error(`Comfy job ${job.id} ${job.status}: ${explain(err)} ${detail}`.trim());
    }

    const outputs = job.getOutputs(map.output);
    const video = outputs.find((o) => o.type === "video" || o.type === "audio") ?? outputs[0];
    if (!video) {
      const seen = job.outputs.map((o) => `${o.name}:${o.type}`).join(", ") || "none";
      throw new Error(`Comfy job ${job.id} (${job.status}) produced no output on node ${map.output}; outputs: ${seen}`);
    }
    const bytes = await withNetworkRetry(() => video.toBytes());
    return { video: bytes, mime: video.contentType || "video/mp4", jobId: job.id, model: map.modelLabel };
  }
}

export class FakeProvider implements VideoProvider {
  readonly name = "fake";
  constructor(private readonly delayMs = 1500) {}

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const fixture = path.resolve(here, "../../test/fixtures/sample.mp4");
    for (let p = 10; p <= 90; p += 20) {
      await new Promise((r) => setTimeout(r, this.delayMs / 5));
      input.onProgress?.(p, "Pretending to render");
    }
    const video = await fs.readFile(fixture).catch(async (err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err;
      // The fixture is gitignored, so CI and fresh clones don't have it: make a short stand-in clip instead.
      const { run, withTempDir } = await import("./transcode.js");
      return withTempDir(async (dir) => {
        const out = path.join(dir, "out.mp4");
        await run(["-f", "lavfi", "-i", "testsrc2=size=480x832:rate=24", "-f", "lavfi", "-i", "sine=frequency=220", "-t", "3", "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", out], 60_000);
        return fs.readFile(out);
      });
    });
    return { video: new Uint8Array(video), mime: "video/mp4", model: "fake" };
  }

  /** Makes a local stand-in with ffmpeg: a still of the first uploaded image (or a test pattern) with a tone. */
  async runGraph(input: GraphJob): Promise<GenerateOutput> {
    for (let p = 10; p <= 90; p += 40) {
      await new Promise((r) => setTimeout(r, this.delayMs / 3));
      input.onProgress?.(p, "Pretending to render");
    }
    const { run, withTempDir } = await import("./transcode.js");
    const bytes = await withTempDir(async (dir) => {
      const out = path.join(dir, input.kind === "audio" ? "out.mp3" : "out.mp4");
      const seconds = String(input.seconds);
      if (input.kind === "image") {
        const png = path.join(dir, "out.png");
        await run(["-f", "lavfi", "-i", "testsrc2=size=768x1024", "-frames:v", "1", png], 30_000);
        return new Uint8Array(await fs.readFile(png));
      }
      if (input.kind === "audio") {
        await run(["-f", "lavfi", "-i", `sine=frequency=330:duration=${seconds}`, "-ac", "2", out], 60_000);
      } else {
        const image = input.uploads.find(([, , , name]) => /\.(jpe?g|png)$/i.test(name));
        const picture = image ? path.join(dir, "frame.jpg") : null;
        if (image && picture) await fs.writeFile(picture, image[2]);
        const source = picture ? ["-loop", "1", "-i", picture] : ["-f", "lavfi", "-i", "testsrc2=size=480x832:rate=24"];
        await run([...source, "-f", "lavfi", "-i", "sine=frequency=220", "-t", seconds, "-vf", "scale=480:832:force_original_aspect_ratio=increase,crop=480:832,fps=24,format=yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", out], 60_000);
      }
      return new Uint8Array(await fs.readFile(out));
    });
    const mime = { audio: "audio/mpeg", image: "image/png", video: "video/mp4" }[input.kind];
    return { video: bytes, mime, model: "fake" };
  }

  async resume(): Promise<GenerateOutput> {
    throw new Error("The fake provider has no jobs to resume.");
  }
}

export function createProvider(cfg: Config): VideoProvider {
  switch (cfg.COMFY_MODE) {
    case "workflow": return new WorkflowProvider(cfg);
    case "fake": return new FakeProvider(cfg.NODE_ENV === "test" ? 10 : 1500);
  }
}
