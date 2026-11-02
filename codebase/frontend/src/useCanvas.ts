import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, fetchCanvas, fetchStory, updateCanvas, type Canvas, type Card, type GenerationStatus, type Story, type Viewport } from "./api";

const POLL_MS = 3000;
const SAVE_MS = 500;

const working = (status: GenerationStatus) => status === "queued" || status === "running";

/** True while the server is still making an asset or a video on this canvas. */
export function canvasBusy(canvas: Canvas): boolean {
  return canvas.assets.some((a) => working(a.status)) || canvas.videos.some((v) => working(v.status));
}

type Spot = { x: number; y: number };

/**
 * Loads one canvas and polls it every 3s while anything on it is still being made.
 * Card moves and the viewport are local first: moved cards keep their local spot over
 * whatever a poll says until the server has saved it, so a poll never snaps a card back.
 * Both are saved together half a second after the last change.
 */
export function useCanvas(id: string) {
  const [canvas, setCanvas] = useState<Canvas | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [moved, setMoved] = useState<Record<string, Spot>>({});
  const [viewport, setViewportState] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [loadedViewport, setLoadedViewport] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const latest = useRef({ canvas, moved, viewport });
  latest.current = { canvas, moved, viewport };
  const timer = useRef<number | undefined>(undefined);
  const dirty = useRef(false);
  const gotViewport = useRef(false);

  const reload = useCallback(async () => {
    try {
      const next = await fetchCanvas(id);
      setCanvas(next);
      if (!gotViewport.current) {
        gotViewport.current = true;
        setViewportState(next.board.viewport);
        setLoadedViewport(true);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const busy = canvas ? canvasBusy(canvas) : false;
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => void reload(), POLL_MS);
    return () => window.clearInterval(t);
  }, [busy, reload]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    const { canvas: current, moved: spots, viewport: view } = latest.current;
    if (!current?.isOwner) return;
    const cards = current.board.cards.map((c) => (spots[c.id] ? { ...c, ...spots[c.id] } : c));
    try {
      const next = await updateCanvas(id, { board: { cards, viewport: view } });
      setSaveError(null);
      setCanvas(next);
      // Forget local spots the server now agrees with.
      setMoved((m) => {
        const left: Record<string, Spot> = {};
        for (const [cardId, spot] of Object.entries(m)) {
          const saved = next.board.cards.find((c) => c.id === cardId);
          if (!saved || saved.x !== spot.x || saved.y !== spot.y) left[cardId] = spot;
        }
        return left;
      });
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save the board layout. Check your connection.");
    }
  }, [id]);

  const schedule = useCallback(() => {
    dirty.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_MS);
  }, [flush]);

  /** Move a card. Pass `save: false` while dragging, then save once on drop. */
  const moveCard = useCallback(
    (cardId: string, x: number, y: number, save = true) => {
      setMoved((m) => ({ ...m, [cardId]: { x: Math.round(x), y: Math.round(y) } }));
      if (save) schedule();
    },
    [schedule],
  );

  const setViewport = useCallback(
    (next: Viewport | ((v: Viewport) => Viewport)) => {
      setViewportState(next);
      schedule();
    },
    [schedule],
  );

  // Leaving the page still saves the last move.
  useEffect(() => () => void flush(), [flush]);

  const cards: Card[] = useMemo(
    () => (canvas ? canvas.board.cards.map((c) => (moved[c.id] ? { ...c, ...moved[c.id] } : c)) : []),
    [canvas, moved],
  );

  return { canvas, cards, notFound, accept: setCanvas, moveCard, viewport, setViewport, loadedViewport, saveError, reload };
}

/**
 * The stories of the videos on a canvas, so each video's shots can be drawn as a row.
 * Polls a story while one of its shots is rendering. `put` takes a fresher copy, e.g.
 * from the story strip, which polls on its own while open.
 */
export function useBoardStories(storyIds: string[]) {
  const [stories, setStories] = useState<Record<string, Story>>({});
  const asked = useRef(new Set<string>());
  const key = [...storyIds].sort().join(",");

  useEffect(() => {
    for (const storyId of key ? key.split(",") : []) {
      if (asked.current.has(storyId)) continue;
      asked.current.add(storyId);
      fetchStory(storyId)
        .then((s) => setStories((m) => ({ ...m, [s.id]: s })))
        .catch(() => asked.current.delete(storyId));
    }
  }, [key]);

  const rendering = Object.values(stories)
    .filter((s) => s.shots.some((shot) => working(shot.status)))
    .map((s) => s.id)
    .join(",");
  useEffect(() => {
    if (!rendering) return;
    const t = window.setInterval(() => {
      for (const storyId of rendering.split(",")) {
        fetchStory(storyId).then((s) => setStories((m) => ({ ...m, [s.id]: s }))).catch(() => {});
      }
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [rendering]);

  const put = useCallback((story: Story) => setStories((m) => ({ ...m, [story.id]: story })), []);
  return { stories, put };
}
