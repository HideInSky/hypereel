import { useEffect, useState } from "react";
import type { Generation } from "./api";
import { useGeneration } from "./useGeneration";

type Props = {
  id: string;
  seed: Generation | null;
  onBack: () => void;
  onDone: () => void;
  toast: (message: string) => void;
};

const STATUS_LINES = [
  "Studying your references",
  "Blocking the shot",
  "Rendering video and sound with MiniMax H3",
  "Fine-tuning the motion",
];

/** Main-panel view of one generation: progress, then the clip and its actions. */
export default function Stage({ id, seed, onBack, onDone, toast }: Props) {
  const { gen, notFound } = useGeneration(id, seed);
  const [line, setLine] = useState(0);
  const status = gen?.status;

  useEffect(() => {
    if (status !== "queued" && status !== "running") return;
    const t = window.setInterval(() => setLine((n) => (n + 1) % STATUS_LINES.length), 4000);
    return () => window.clearInterval(t);
  }, [status]);

  useEffect(() => {
    if (status === "succeeded" || status === "failed") onDone();
  }, [status, onDone]);

  if (notFound) {
    return (
      <div className="stage stage--message">
        <h2>Clip not found</h2>
        <button type="button" className="ghost" onClick={onBack}>Back to effects</button>
      </div>
    );
  }
  if (!gen) return <div className="stage stage--message"><p className="muted">Loading</p></div>;

  if (gen.status === "failed") {
    return (
      <div className="stage stage--message">
        <h2>That render didn't work</h2>
        <p className="muted">The model may have declined one of the photos, or the service hiccuped. Try a different photo.</p>
        {gen.error && <details className="error-detail"><summary>Details</summary><p>{gen.error}</p></details>}
        <button type="button" className="ghost" onClick={onBack}>Back to effects</button>
      </div>
    );
  }

  if (gen.status !== "succeeded") {
    const percent = Math.max(4, gen.progress);
    return (
      <div className="stage">
        <div className="stage-frame stage-frame--render">
          {gen.posterUrl && <img src={gen.posterUrl} alt="" />}
          <span className="render-tag">{gen.effectLabel}</span>
        </div>
        <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${percent}%` }} />
        </div>
        <p className="stage-line">{STATUS_LINES[line]}</p>
        <p className="muted small">Usually about a minute. You can leave this page; the clip stays in History.</p>
      </div>
    );
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(gen.shareUrl);
      toast("Link copied");
    } catch {
      toast(gen.shareUrl);
    }
  };
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: `${gen.effectLabel}, made with hypereel`, url: gen.shareUrl });
      } catch {
        /* user closed the share sheet */
      }
    } else {
      await copyLink();
    }
  };

  return (
    <div className="stage">
      <div className="stage-frame">
        <video src={gen.videoUrl ?? undefined} poster={gen.posterUrl ?? undefined} controls autoPlay loop playsInline preload="auto" />
      </div>
      <h2 className="stage-title">{gen.effectLabel}</h2>
      <div className="stage-actions">
        <a className="primary" href={gen.videoUrl ?? "#"} download={`hypereel-${gen.effect}-${gen.id}.mp4`}>Download</a>
        <button type="button" className="ghost" onClick={() => void share()}>Share</button>
        <button type="button" className="ghost" onClick={() => void copyLink()}>Copy link</button>
        <button type="button" className="ghost" onClick={onBack}>Try another effect</button>
      </div>
    </div>
  );
}
