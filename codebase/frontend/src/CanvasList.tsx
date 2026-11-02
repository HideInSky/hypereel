import { useEffect, useState } from "react";
import { ApiError, createCanvas, fetchCanvases, type CanvasSummary } from "./api";

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Your canvases, newest first, with a tile to start a new one. */
export default function CanvasList({ onOpen }: { onOpen: (id: string) => void }) {
  const [canvases, setCanvases] = useState<CanvasSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCanvases()
      .then(setCanvases)
      .catch(() => {
        setCanvases([]);
        setError("Can't load your canvases. Refresh to try again.");
      });
  }, []);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      onOpen((await createCanvas()).id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't make a canvas. Try again.");
      setCreating(false);
    }
  };

  return (
    <div className="canvas-list">
      <div className="canvas-list-head">
        <h2>Canvas</h2>
        <p className="muted small">A free board for characters, images and videos. Lines show what was made from what, and any video can grow into a story.</p>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="canvas-grid">
        <button type="button" className="canvas-tile canvas-tile--new" disabled={creating} onClick={() => void create()}>
          <span className="canvas-tile-plus" aria-hidden="true">+</span>
          <strong>{creating ? "Making a canvas" : "New canvas"}</strong>
        </button>
        {canvases?.map((c) => (
          <button type="button" key={c.id} className="canvas-tile" onClick={() => onOpen(c.id)}>
            <span className="canvas-tile-cover">{c.cover && <img src={c.cover} alt="" />}</span>
            <span className="canvas-tile-text">
              <strong>{c.title}</strong>
              <span className="muted small">Edited {when(c.updatedAt)}</span>
            </span>
          </button>
        ))}
      </div>
      {canvases && !canvases.length && !error && <p className="muted small">Your canvases will show up here.</p>}
    </div>
  );
}
