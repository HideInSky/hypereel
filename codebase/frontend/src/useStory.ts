import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchStory, saveLayers, type AudioClip, type GenerationStatus, type Layer, type Story } from "./api";

const POLL_MS = 3000;
const SAVE_MS = 450;

const working = (status: GenerationStatus | undefined) => status === "queued" || status === "running";

/** True while the server is still rendering a shot, making a sound, or exporting. */
export function storyBusy(story: Story): boolean {
  return (
    story.export.status === "rendering" ||
    story.shots.some((s) => working(s.status)) ||
    story.audio.some((l) => "clipId" in l.source && working(story.clips[l.source.clipId]?.status))
  );
}

/**
 * Loads one story and polls it every 3s while anything in it is still working.
 * Layer edits show at once and are saved a moment later, so dragging a slider
 * sends one request instead of fifty. `edits` counts local changes: a poll or save
 * that started before the latest change is dropped instead of undoing it.
 */
export function useStory(id: string, seed: Story | null) {
  const [story, setStory] = useState<Story | null>(seed && seed.id === id ? seed : null);
  const [notFound, setNotFound] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const edits = useRef(0);
  const pending = useRef<Layer[] | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  const reload = useCallback(async () => {
    const started = edits.current;
    try {
      const next = await fetchStory(id);
      if (edits.current === started && !pending.current) setStory(next);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      // Anything else: the next poll tries again.
    }
  }, [id]);

  useEffect(() => {
    setNotFound(false);
    void reload();
  }, [reload]);

  const busy = story ? storyBusy(story) : false;
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void reload(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [busy, reload]);

  /** Take a story the server just sent back from a change. */
  const accept = useCallback((next: Story) => {
    edits.current += 1;
    setStory(next);
  }, []);

  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const layers = pending.current;
    if (!layers) return;
    pending.current = null;
    const sent = edits.current;
    setSaving(true);
    try {
      const next = await saveLayers(id, layers);
      setSaveError(null);
      if (edits.current === sent && !pending.current) setStory(next);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save your sound changes. Try again.");
      if (edits.current === sent) void reload();
    } finally {
      setSaving(false);
    }
  }, [id, reload]);

  /** Show new layers now and save them shortly (or right away with `now`). */
  const setLayers = useCallback(
    (layers: Layer[], options: { now?: boolean; clip?: AudioClip } = {}) => {
      edits.current += 1;
      setStory((s) => s && { ...s, audio: layers, clips: options.clip ? { ...s.clips, [options.clip.id]: options.clip } : s.clips });
      pending.current = layers;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void flush(), options.now ? 0 : SAVE_MS);
    },
    [flush],
  );

  // Leaving mid-edit still saves the last change.
  useEffect(() => () => void flush(), [flush]);

  return { story, notFound, accept, setLayers, flush, saving, saveError, setSaveError };
}

export type LayerKind = "original" | "music" | "sfx" | "library";

export const LAYER_KIND_LABEL: Record<LayerKind, string> = {
  original: "Original sound",
  music: "Music",
  sfx: "Sound effect",
  library: "Library sound",
};

export function layerKind(layer: Layer, clips: Story["clips"]): LayerKind {
  return "clipId" in layer.source ? (clips[layer.source.clipId]?.kind ?? "sfx") : "library";
}

/** Where each shot starts, in seconds from the start of the story. */
export function shotStarts(story: Story): Record<string, number> {
  const starts: Record<string, number> = {};
  let at = 0;
  for (const shot of story.shots) {
    starts[shot.id] = at;
    at += shot.seconds;
  }
  return starts;
}

/** Length of the story: the shots end to end, or the server's figure if longer. */
export function storyLength(story: Story): number {
  return Math.max(story.totalSeconds, story.shots.reduce((sum, s) => sum + s.seconds, 0));
}

/** 75.4 -> "1:15" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 5 -> "5 seconds", 2.5 -> "2.5 seconds" */
export function secondsText(seconds: number): string {
  const n = Math.round(seconds * 10) / 10;
  return `${n} second${n === 1 ? "" : "s"}`;
}

export const newLayerId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
