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

export interface ResumeInput {
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

  async resume(input: ResumeInput): Promise<GenerateOutput> {
    const { Comfy } = await import("@comfyorg/sdk");
    const client = new Comfy({ apiKey: this.cfg.COMFY_API_KEY });
    const map = await this.read<WorkflowMap>(this.cfg.COMFY_WORKFLOW_MAP_PATH);
    const job = await withNetworkRetry(() => client.jobs.get(input.jobId));
    return this.collect(job, map, input);
  }

  /** Waits for a submitted job to finish, then downloads the video. */
  private async collect(job: Job, map: WorkflowMap, input: Pick<GenerateInput, "onProgress" | "signal">): Promise<GenerateOutput> {
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
    const video = outputs.find((o) => o.type === "video") ?? outputs[0];
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
    const video = await fs.readFile(fixture);
    return { video: new Uint8Array(video), mime: "video/mp4", model: "fake" };
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
