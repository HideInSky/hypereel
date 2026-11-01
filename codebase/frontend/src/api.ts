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
