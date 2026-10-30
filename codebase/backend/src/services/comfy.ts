// The ONLY file that knows about Comfy / MiniMax H3. The rest of the app talks
// to `VideoProvider`, so swapping the model or the hosting surface is a
// one-file change (dev-guide rule 1: isolate vendor code behind a thin wrapper).
//
// Three providers:
//  - WorkflowProvider: runs the exported ComfyUI workflow JSON on Comfy Cloud
//    through the official SDK. This is "built with ComfyUI" in the literal sense:
//    the same workflow file opens in the ComfyUI editor.
//  - RouterProvider:   calls the model directly via Comfy Router (fallback).
//  - FakeProvider:     offline stub for UI work and tests. Costs nothing.
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.js";

export interface GenerateInput {
  imageBytes: Uint8Array;
  imageExt: "jpg" | "png";
  prompt: string;
  seconds: number;
  resolution: string;
  onProgress?: (percent: number, note?: string) => void;
  signal?: AbortSignal;
}

export interface GenerateOutput {
  video: Uint8Array;
  mime: string;
  jobId?: string;
  model: string;
  /** The scene the script-writer node wrote (writer workflows only). */
  script?: string;
}

/**
 * "brief":  the provider has its own script-writer step; send it a writer brief
 *           (genre style + punchline beat + user note), see buildWriterBrief().
 * "prompt": send the finished video prompt directly (static templates).
 */
export type PromptKind = "brief" | "prompt";

export interface VideoProvider {
  readonly name: string;
  readonly promptKind: PromptKind;
  generate(input: GenerateInput): Promise<GenerateOutput>;
}

/**
 * Maps the abstract inputs onto node ids in the exported workflow. Lives in
 * workflows/*_map.json next to the workflow so re-exporting the workflow from
 * ComfyUI only means updating ids, not code.
 */
interface WorkflowMap {
  loadImage: { node: string; input: string }; // LoadImage node, file widget
  // Where the text goes: the script-writer node's prompt (writer workflow) or
  // the video node's prompt (plain workflow).
  prompt: { node: string; input: string };
  writerSeed?: { node: string; input: string }; // randomized so the writer varies too
  script?: string; // node id of SaveText holding the written script; its presence = writer workflow
  duration?: { node: string; input: string };
  resolution?: { node: string; input: string };
  model?: { node: string; input: string; value: string };
  seed?: { node: string; input: string }; // randomized per run so remixes differ
  output: string; // node id whose output is the video (SaveVideo)
  modelLabel: string; // human label stored in DB, e.g. "MiniMax H3 Max Turbo"
}

const here = path.dirname(fileURLToPath(import.meta.url));

export class WorkflowProvider implements VideoProvider {
  readonly name = "comfy-workflow";
  readonly promptKind: PromptKind;
  private readonly map: WorkflowMap;

  constructor(private readonly cfg: Config) {
    const mapPath = path.resolve(here, "../..", cfg.COMFY_WORKFLOW_MAP_PATH);
    this.map = JSON.parse(readFileSync(mapPath, "utf8")) as WorkflowMap;
    this.promptKind = this.map.script ? "brief" : "prompt";
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const { Comfy } = await import("@comfyorg/sdk");
    const client = new Comfy({ apiKey: this.cfg.COMFY_API_KEY });
    const map = this.map;

    const wfPath = path.resolve(here, "../..", this.cfg.COMFY_WORKFLOW_PATH);
    const wf = await client.workflows.fromFile(wfPath);
    // The SDK hashes + uploads the image (dedup-aware) and binds the server-side
    // filename to the LoadImage node's file widget.
    const asset = client.assets.fromBytes(input.imageBytes, { filename: `input.${input.imageExt}` });
    wf.setInput(map.loadImage.node, map.loadImage.input, asset);
    wf.setInput(map.prompt.node, map.prompt.input, input.prompt);
    if (map.duration) wf.setInput(map.duration.node, map.duration.input, input.seconds);
    if (map.resolution) wf.setInput(map.resolution.node, map.resolution.input, input.resolution);
    if (map.model) wf.setInput(map.model.node, map.model.input, map.model.value);
    if (map.seed) wf.setInput(map.seed.node, map.seed.input, Math.floor(Math.random() * 4_294_967_295));
    if (map.writerSeed) wf.setInput(map.writerSeed.node, map.writerSeed.input, Math.floor(Math.random() * 2_147_483_647));

    input.onProgress?.(5, "Submitting to Comfy Cloud");
    // Two different keys, often the same value: the constructor key authenticates
    // US to Comfy Cloud; this one authenticates the partner node (MiniMax H3)
    // INSIDE the workflow and is what gets billed.
    const job = await client.submit(wf, { signal: input.signal, apiKey: this.cfg.COMFY_API_KEY });

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
    // result() waits for a terminal state and throws JobFailed unless it succeeded
    // (wait() alone does NOT throw on failure).
    try {
      await job.result(input.signal);
    } catch (err) {
      const detail = job.error ? JSON.stringify(job.error).slice(0, 400) : "";
      throw new Error(`Comfy job ${job.id} ${job.status}: ${(err as Error).message} ${detail}`.trim());
    }

    const outputs = job.getOutputs(map.output);
    const video = outputs.find((o) => o.type === "video") ?? outputs[0];
    if (!video) {
      const seen = job.outputs.map((o) => `${o.name}:${o.type}`).join(", ") || "none";
      throw new Error(`Comfy job ${job.id} (${job.status}) produced no output on node ${map.output}; outputs: ${seen}`);
    }
    const bytes = await video.toBytes();
    // The script is nice-to-have (shown under the video); never fail the clip over it.
    let script: string | undefined;
    if (map.script) {
      const file = job.getOutputs(map.script)[0];
      if (file) script = new TextDecoder().decode(await file.toBytes()).trim().slice(0, 2000) || undefined;
    }
    return { video: bytes, mime: video.contentType || "video/mp4", jobId: job.id, model: map.modelLabel, script };
  }
}

export class RouterProvider implements VideoProvider {
  readonly name = "comfy-router";
  readonly promptKind = "prompt";
  constructor(private readonly cfg: Config) {}

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const { Comfy, comfy } = await import("@comfyorg/sdk");
    const client = new Comfy({ apiKey: this.cfg.COMFY_API_KEY });
    comfy.config({ credentials: this.cfg.COMFY_API_KEY });

    // Router forwards the model's native body, so the image goes in as a URL
    // the provider can fetch: upload it as an asset and use its signed URL.
    const asset = client.assets.fromBytes(input.imageBytes, { filename: `input.${input.imageExt}` });
    const { url } = await asset.getDownloadUrl();
    input.onProgress?.(10, "Submitting to Comfy Router");

    const result = await comfy.models.run(
      this.cfg.COMFY_ROUTER_MODEL,
      {
        prompt: input.prompt,
        first_frame_image: url,
        duration: input.seconds,
        resolution: input.resolution,
      },
      { signal: input.signal, timeoutMs: 15 * 60 * 1000 },
    );
    input.onProgress?.(90, "Downloading");

    if (result.kind === "binary") {
      return { video: result.data, mime: result.contentType || "video/mp4", model: this.cfg.COMFY_ROUTER_MODEL };
    }
    // JSON result: find a video URL in the provider payload (shape differs per provider).
    const videoUrl = findVideoUrl(result.data);
    if (!videoUrl) throw new Error(`Router returned no video url: ${JSON.stringify(result.data).slice(0, 300)}`);
    const res = await fetch(videoUrl, { signal: input.signal });
    if (!res.ok) throw new Error(`Failed to download video (${res.status})`);
    return {
      video: new Uint8Array(await res.arrayBuffer()),
      mime: res.headers.get("content-type") || "video/mp4",
      model: this.cfg.COMFY_ROUTER_MODEL,
    };
  }
}

function findVideoUrl(data: unknown): string | undefined {
  if (typeof data === "string") return /^https?:\/\/.*\.(mp4|webm)(\?|$)/i.test(data) ? data : undefined;
  if (Array.isArray(data)) for (const d of data) { const u = findVideoUrl(d); if (u) return u; }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["video_url", "url", "video", "output", "outputs", "data", "result"]) {
      if (key in obj) { const u = findVideoUrl(obj[key]); if (u) return u; }
    }
    for (const v of Object.values(obj)) { const u = findVideoUrl(v); if (u) return u; }
  }
  return undefined;
}

export class FakeProvider implements VideoProvider {
  readonly name = "fake";
  readonly promptKind = "prompt";
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
}

export function createProvider(cfg: Config): VideoProvider {
  switch (cfg.COMFY_MODE) {
    case "workflow": return new WorkflowProvider(cfg);
    case "router": return new RouterProvider(cfg);
    case "fake": return new FakeProvider(cfg.NODE_ENV === "test" ? 10 : 1500);
  }
}
