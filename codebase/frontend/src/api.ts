// Typed helpers for talking to the backend. Every URL is relative ("/api/...")
// because in production the backend serves this app from the same origin, and
// in development Vite proxies these paths to localhost:3000 (see vite.config.ts).

export type Effect = {
  id: string;
  label: string;
  description: string;
  seconds: number;
  /** Example clip, e.g. "/effects/vanish.mp4". Null until one has been rendered. */
  preview: string | null;
  /** Still frame shown until the clip is ready. */
  poster: string | null;
  /** Shape of the gallery tile, as "width:height". */
  ratio: string;
  /** Written in Effect Studio rather than built in. */
  custom?: boolean;
  /** Contributed to the repo as a JSON recipe. */
  community?: boolean;
  remixOf?: string | null;
};

export type ReferenceRole = "character" | "location" | "product";

export type GenerationStatus = "queued" | "running" | "succeeded" | "failed";

export type Generation = {
  id: string;
  status: GenerationStatus;
  /** 0-100 */
  progress: number;
  effect: string;
  effectLabel: string;
  /** The user's optional extra direction. */
  prompt: string | null;
  model: string;
  resolution: string | null;
  aspectRatio: string | null;
  error: string | null;
  /** e.g. "/media/abc.mp4" — only set once status is "succeeded" */
  videoUrl: string | null;
  /** The first character photo, only for the clip's owner, e.g. "/media/abc.jpg" */
  posterUrl: string | null;
  /** Absolute URL of the share page (/v/:id) */
  shareUrl: string;
  createdAt: string;
};

/**
 * Thrown when the backend answers with a non-2xx status. `message` is the
 * backend's friendly error text, safe to show to the user as-is.
 */
export class ApiError extends Error {
  status: number;
  /** Only present on 429: which limit was hit. */
  reason?: "session" | "ip" | "global";

  constructor(message: string, status: number, reason?: ApiError["reason"]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.reason = reason;
  }
}

/** fetch + JSON parse + turn error responses into ApiError. */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }

  // The backend always answers JSON, but guard against proxies/HTML error pages.
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body: handled below */
  }

  if (!res.ok) {
    const obj = (body ?? {}) as { error?: string; reason?: ApiError["reason"] };
    throw new ApiError(obj.error ?? `Request failed (${res.status})`, res.status, obj.reason);
  }
  return body as T;
}

export function fetchEffects(): Promise<Effect[]> {
  return request<Effect[]>("/api/effects");
}

export function fetchGeneration(id: string): Promise<Generation> {
  return request<Generation>(`/api/generations/${encodeURIComponent(id)}`);
}

export function fetchHistory(): Promise<Generation[]> {
  return request<Generation[]>("/api/history");
}

/** Upload the references and start a render. Resolves with the queued Generation (HTTP 202). */
export function createGeneration(input: {
  effect: string;
  uploads: Record<ReferenceRole, File[]>;
  prompt?: string;
  resolution: string;
  aspectRatio: string;
}): Promise<Generation> {
  const form = new FormData();
  // Text fields first: the server reads the multipart stream in order.
  form.append("effect", input.effect);
  form.append("resolution", input.resolution);
  form.append("aspectRatio", input.aspectRatio);
  if (input.prompt && input.prompt.trim()) form.append("prompt", input.prompt.trim());
  for (const [role, files] of Object.entries(input.uploads)) {
    for (const file of files) form.append(role, file);
  }
  // Note: no Content-Type header here. The browser sets the multipart boundary itself.
  return request<Generation>("/api/generations", { method: "POST", body: form });
}

export type RecipeBeat = { from: number; to: number; action: string };

/** The open effect format, hypereel-effect/1. */
export type Recipe = {
  format?: string;
  name: string;
  description: string;
  seconds: number;
  look: "photoreal" | "stylized";
  camera: string;
  beats: RecipeBeat[];
  product: string;
  sound: string;
};

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function fetchMyEffects(): Promise<Effect[]> {
  return request<Effect[]>("/api/custom-effects");
}

export function fetchCustomEffect(id: string): Promise<Effect> {
  return request<Effect>(`/api/custom-effects/${encodeURIComponent(id)}`);
}

export function saveCustomEffect(recipe: Recipe, remixOf: string | null): Promise<Effect> {
  return request<Effect>("/api/custom-effects", json({ recipe, remixOf }));
}

export function fetchRecipe(effectId: string): Promise<{ recipe: Recipe }> {
  return request<{ recipe: Recipe }>(`/api/effects/${encodeURIComponent(effectId)}/recipe`);
}

export function fetchCommunityRecipes(): Promise<{ id: string; recipe: Recipe }[]> {
  return request<{ id: string; recipe: Recipe }[]>("/api/community-recipes");
}

export type ImageCounts = { characters: number; locations: number; products: number };

const countsQuery = (c: ImageCounts) => new URLSearchParams({ characters: String(Math.max(1, c.characters)), locations: String(c.locations), products: String(c.products) });

export function previewRecipe(recipe: Recipe, counts: ImageCounts): Promise<{ prompt: string }> {
  return request<{ prompt: string }>(`/api/recipes/preview?${countsQuery(counts)}`, json({ recipe }));
}

/** A ComfyUI workflow for this effect and these inputs, served as a download. */
export function workflowUrl(effectId: string, counts: ImageCounts, options: { note?: string; resolution: string; aspectRatio: string }): string {
  const q = countsQuery(counts);
  q.set("resolution", options.resolution);
  q.set("aspectRatio", options.aspectRatio);
  if (options.note?.trim()) q.set("note", options.note.trim().slice(0, 300));
  return `/api/effects/${encodeURIComponent(effectId)}/workflow?${q}`;
}

// ---------- Stories: a clip plus shots before and after it, with sound laid over ----------

export type ShotMode = "original" | "continue" | "restage";
export type ShotSide = "before" | "after";

/** One shot of a story. `seconds` is the real length once rendered, else the length asked for. */
export type Shot = Generation & { mode: ShotMode; side: ShotSide | null; seconds: number };

export type AudioKind = "music" | "sfx" | "original";

/** A sound made for a story: AI music, an AI sound effect, or a shot's own sound. */
export type AudioClip = {
  id: string;
  kind: AudioKind;
  label: string;
  status: GenerationStatus;
  url: string | null;
  seconds: number;
  error: string | null;
  /** For original sound: the shot it came from. The server keeps its layer lined up with that shot. */
  shotId?: string | null;
};

/** A ready-made sound from the built-in library. */
export type LibrarySound = { id: string; label: string; url: string; seconds: number | null; license: string; credit: string };

/** One sound layer. Every layer plays at the same time over the whole story. */
export type Layer = {
  /** Made in the browser; any short unique string. */
  id: string;
  source: { clipId: string } | { sound: string };
  label: string;
  /** Seconds from the start of the story. */
  start: number;
  /** Seconds, or null to play to the end of the story. */
  length: number | null;
  /** 0-2, 1 = as recorded */
  volume: number;
  loop: boolean;
};

export type ExportStatus = null | "rendering" | "ready" | "failed";

export type Story = {
  id: string;
  title: string;
  isOwner: boolean;
  /** In play order. */
  shots: Shot[];
  audio: Layer[];
  clips: Record<string, AudioClip>;
  totalSeconds: number;
  export: { status: ExportStatus; url: string | null; stale: boolean; error: string | null };
  shareUrl: string;
};

export const MAX_LAYERS = 12;

const put = (body: unknown): RequestInit => ({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const storyPath = (id: string) => `/api/sequences/${encodeURIComponent(id)}`;

/** Start a story from a finished clip the viewer owns. */
export function createStory(sourceId: string): Promise<Story> {
  return request<Story>("/api/sequences", json({ sourceId }));
}

export function fetchStory(id: string): Promise<Story> {
  return request<Story>(storyPath(id));
}

export type NewShot = {
  anchorId: string;
  side: ShotSide;
  mode: "continue" | "restage";
  action: string;
  place: string;
  style: string;
  light: string;
  keepMoves: boolean;
  seconds: number;
  /** Restage only, up to 4. */
  characters: File[];
};

/** Queue a new shot next to `anchorId`. Resolves with the whole story (HTTP 202). */
export function addShot(storyId: string, shot: NewShot): Promise<Story> {
  const form = new FormData();
  // Text fields first: the server reads the multipart stream in order.
  form.append("anchorId", shot.anchorId);
  form.append("side", shot.side);
  form.append("mode", shot.mode);
  form.append("action", shot.action.trim());
  form.append("place", shot.place.trim());
  form.append("style", shot.style.trim());
  form.append("light", shot.light.trim());
  form.append("keepMoves", String(shot.mode === "restage" && shot.keepMoves));
  form.append("seconds", String(shot.seconds));
  if (shot.mode === "restage") for (const file of shot.characters) form.append("character", file);
  return request<Story>(`${storyPath(storyId)}/shots`, { method: "POST", body: form });
}

export function deleteShot(storyId: string, shotId: string): Promise<Story> {
  return request<Story>(`${storyPath(storyId)}/shots/${encodeURIComponent(shotId)}`, { method: "DELETE" });
}

/** Replace all sound layers at once. */
export function saveLayers(storyId: string, layers: Layer[]): Promise<Story> {
  return request<Story>(`${storyPath(storyId)}/audio`, put({ layers }));
}

/** Render the final stitched video on the server. Resolves at once (HTTP 202); poll the story. */
export function exportStory(storyId: string): Promise<Story> {
  return request<Story>(`${storyPath(storyId)}/export`, { method: "POST" });
}

/** Make AI music or a sound effect. Uses credits. Resolves with the queued clip (HTTP 202). */
export function createAudio(kind: "music" | "sfx", prompt: string, seconds: number): Promise<AudioClip> {
  return request<AudioClip>("/api/audio", json({ kind, prompt, seconds }));
}

/** Lift a rendered shot's own sound into a clip. Fails with 422 if the shot has none. */
export function originalAudio(shotId: string): Promise<AudioClip> {
  return request<AudioClip>("/api/audio/original", json({ shotId }));
}

export function fetchSounds(): Promise<LibrarySound[]> {
  return request<LibrarySound[]>("/api/sounds");
}

// ---------- Canvas: a free board of assets and videos, with lines for what came from what ----------

export type Card = { id: string; kind: "asset" | "video"; refId: string; x: number; y: number };
/** `x`/`y` are the screen offset of the board's origin in px; `zoom` 1 = 100%. */
export type Viewport = { x: number; y: number; zoom: number };
export type Board = { cards: Card[]; viewport: Viewport };

export type AssetKind = "image" | "character" | "sheet";

export type Asset = {
  id: string;
  kind: AssetKind;
  name: string;
  status: GenerationStatus;
  /** Picture URLs: one for an image or sheet, up to 4 for a character. */
  images: string[];
  prompt: string | null;
  /** Ids of the assets it was made from: a sheet's character, or a generated image's references. */
  sources: string[];
  error: string | null;
  createdAt: string;
};

export type CanvasVideo = Generation & { assetIds: string[]; storyId: string | null };

export type Canvas = { id: string; title: string; isOwner: boolean; board: Board; assets: Asset[]; videos: CanvasVideo[]; shareUrl: string };

export type CanvasSummary = { id: string; title: string; updatedAt: string; cover: string | null };

const canvasPath = (id: string) => `/api/canvases/${encodeURIComponent(id)}`;
const patch = (body: unknown): RequestInit => ({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function createCanvas(title?: string): Promise<Canvas> {
  return request<Canvas>("/api/canvases", json(title ? { title } : {}));
}

/** The viewer's canvases, newest first. */
export function fetchCanvases(): Promise<CanvasSummary[]> {
  return request<CanvasSummary[]>("/api/canvases");
}

export function fetchCanvas(id: string): Promise<Canvas> {
  return request<Canvas>(canvasPath(id));
}

/** Rename, or save card positions and the viewport. */
export function updateCanvas(id: string, changes: { title?: string; board?: Board }): Promise<Canvas> {
  return request<Canvas>(canvasPath(id), patch(changes));
}

/** Upload 1-4 photos as an image or a character. Free. */
export function uploadAsset(canvasId: string, kind: "image" | "character", name: string, photos: File[]): Promise<Canvas> {
  const form = new FormData();
  // Text fields first: the server reads the multipart stream in order.
  form.append("kind", kind);
  form.append("name", name.trim());
  for (const photo of photos) form.append("photo", photo);
  return request<Canvas>(`${canvasPath(canvasId)}/assets`, { method: "POST", body: form });
}

/** Generate an image or an invented character from a prompt, optionally from up to 4 reference assets. Uses credits. */
export function generateAsset(canvasId: string, input: { kind: "image" | "character"; name: string; prompt: string; sourceIds: string[] }): Promise<Canvas> {
  return request<Canvas>(`${canvasPath(canvasId)}/assets/generate`, json({ ...input, name: input.name.trim(), prompt: input.prompt.trim() }));
}

/** Make a character sheet (front, side, back, close-ups) from a character asset. Uses credits. */
export function makeSheet(canvasId: string, assetId: string): Promise<Canvas> {
  return request<Canvas>(`${canvasPath(canvasId)}/assets/${encodeURIComponent(assetId)}/sheet`, { method: "POST" });
}

export function deleteAsset(canvasId: string, assetId: string): Promise<Canvas> {
  return request<Canvas>(`${canvasPath(canvasId)}/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
}

export type NewVideo = {
  /** Use this effect, with `prompt` as extra direction. Without it, `prompt` is required. */
  effect?: string;
  prompt?: string;
  characters: string[];
  locations: string[];
  products: string[];
  resolution: string;
  aspectRatio: string;
  /** Free prompt only. */
  seconds?: number;
};

/** Render a video from assets on the board. Uses credits. */
export function makeVideo(canvasId: string, input: NewVideo): Promise<Canvas> {
  return request<Canvas>(`${canvasPath(canvasId)}/videos`, json(input));
}

/** The video's story, created on first use. */
export function videoStory(canvasId: string, videoId: string): Promise<{ storyId: string }> {
  return request<{ storyId: string }>(`${canvasPath(canvasId)}/videos/${encodeURIComponent(videoId)}/story`, { method: "POST" });
}

export function deleteVideo(canvasId: string, videoId: string): Promise<Canvas> {
  return request<Canvas>(`${canvasPath(canvasId)}/videos/${encodeURIComponent(videoId)}`, { method: "DELETE" });
}
