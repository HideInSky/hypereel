import { useEffect, useRef, useState } from "react";
import type { Generation, Genre } from "./api";

const STATUS_LINES = [
  "Studying your photo for comedic potential…",
  "Writing the punchline…",
  "Hiring a narrator…",
  "Cueing the orchestra…",
  "Adding unnecessary lens flares…",
  "Rendering with MiniMax H3 on ComfyUI…",
  "Arguing with the sound designer…",
  "Slowing everything down for drama…",
  "Polishing the BWAAAM…",
];

type Props = { gen: Generation; genres: Genre[] };

/** Poster + cinematic progress bar while the backend renders the clip. */
export default function Rendering({ gen, genres }: Props) {
  const [lineIdx, setLineIdx] = useState(0);
  // Progress from the backend can wobble; remember the highest value so the
  // bar never visibly moves backwards.
  const maxProgress = useRef(0);
  maxProgress.current = Math.max(maxProgress.current, gen.progress, gen.status === "running" ? 5 : 2);
  const pct = Math.min(maxProgress.current, 99);

  useEffect(() => {
    const t = window.setInterval(() => setLineIdx((i) => (i + 1) % STATUS_LINES.length), 2600);
    return () => window.clearInterval(t);
  }, []);

  const genre = genres.find((g) => g.id === gen.genre);

  return (
    <section className="card rendering">
      <div className="poster-wrap">
        {gen.posterUrl && <img src={gen.posterUrl} alt="" className="poster poster--dim" />}
        <div className="rec" aria-hidden="true">
          <span className="rec-dot" /> REC
        </div>
      </div>

      <h2 className="title">
        {genre?.emoji ?? "🎬"} {gen.status === "queued" ? "Waiting for a free set…" : "Rolling…"}
      </h2>

      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>

      <p className="status-line" aria-live="polite">
        {STATUS_LINES[lineIdx]}
      </p>
      <p className="muted small center">Usually 30–90 seconds. Keep this tab open — or come back, the link will still work.</p>
    </section>
  );
}
