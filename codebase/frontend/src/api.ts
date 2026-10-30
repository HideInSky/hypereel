// Typed helpers for talking to the backend. Every URL is relative ("/api/...")
// because in production the backend serves this app from the same origin, and
// in development Vite proxies these paths to localhost:3000 (see vite.config.ts).

export type Genre = {
  id: string;
  label: string;
  emoji: string;
  tagline: string;
};

export type GenerationStatus = "queued" | "running" | "succeeded" | "failed";

export type Generation = {
  id: string;
  status: GenerationStatus;
  /** 0-100 */
  progress: number;
  genre: string;
  caption: string | null;
  /** The scene the AI script writer wrote for this clip (null for older clips). */
  script: string | null;
  model: string;
  error: string | null;
  /** e.g. "/media/abc.mp4" — only set once status is "succeeded" */
  videoUrl: string | null;
  /** The uploaded photo, e.g. "/media/abc.jpg" */
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

export function fetchGenres(): Promise<Genre[]> {
  return request<Genre[]>("/api/genres");
}

export function fetchGeneration(id: string): Promise<Generation> {
  return request<Generation>(`/api/generations/${encodeURIComponent(id)}`);
}

export function fetchFeed(): Promise<Generation[]> {
  return request<Generation[]>("/api/feed");
}

/** Upload a photo and start a render. Resolves with the queued Generation (HTTP 202). */
export function createGeneration(input: { image: File; genre: string; caption?: string }): Promise<Generation> {
  const form = new FormData();
  form.append("image", input.image);
  form.append("genre", input.genre);
  if (input.caption && input.caption.trim()) form.append("caption", input.caption.trim());
  // Note: no Content-Type header here — the browser sets the multipart boundary itself.
  return request<Generation>("/api/generations", { method: "POST", body: form });
}

/**
 * Download an existing poster image and wrap it as a File so the compose
 * screen can treat it exactly like a freshly picked photo (used by Remix).
 */
export async function fetchPosterAsFile(posterUrl: string): Promise<File> {
  const res = await fetch(posterUrl, { credentials: "same-origin" });
  if (!res.ok) throw new ApiError("Couldn't load the original photo.", res.status);
  const blob = await res.blob();
  const ext = blob.type.split("/")[1] ?? "jpg";
  return new File([blob], `remix.${ext}`, { type: blob.type || "image/jpeg" });
}
