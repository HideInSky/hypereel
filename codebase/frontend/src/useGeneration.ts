import { useEffect, useState } from "react";
import { ApiError, fetchGeneration, type Generation } from "./api";

const POLL_MS = 1500;
const RETRY_MS = 3000;

/**
 * Loads one generation and keeps polling it every 1.5s until it is finished
 * (succeeded or failed). `seed` is an optional Generation we already have
 * (e.g. the 202 response right after upload) so the UI can render instantly.
 */
export function useGeneration(id: string, seed: Generation | null) {
  const [gen, setGen] = useState<Generation | null>(seed && seed.id === id ? seed : null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false; // set to true when the component unmounts or `id` changes
    let timer: number | undefined;

    const tick = async () => {
      try {
        const next = await fetchGeneration(id);
        if (cancelled) return;
        setGen(next);
        // Keep polling only while the backend is still working on it.
        if (next.status === "queued" || next.status === "running") {
          timer = window.setTimeout(tick, POLL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
          return;
        }
        // Network hiccup: try again a bit later instead of giving up.
        timer = window.setTimeout(tick, RETRY_MS);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [id]);

  return { gen, notFound };
}
