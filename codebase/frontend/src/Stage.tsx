import { useEffect, useState } from "react";
import { ApiError, saveToLibrary, type Generation } from "./api";
import { goToAssets } from "./useLibrary";
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
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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

  // Only the owner gets the source photo back as posterUrl, and only they can save the clip.
  const owner = gen.posterUrl !== null;
  const savedId = saved ?? gen.savedId ?? null;
  const save = async () => {
    setSaving(true);
    try {
      setSaved((await saveToLibrary({ from: "video", generationId: gen.id })).id);
      toast("Saved to Assets");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't save it to Assets. Try again.");
    } finally {
      setSaving(false);
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
        {owner &&
          (savedId ? (
            <a className="ghost" href={`/?assets=${encodeURIComponent(savedId)}`} onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              goToAssets(savedId);
            }}>In your Assets</a>
          ) : (
            <button type="button" className="ghost" disabled={saving} onClick={() => void save()}>{saving ? "Saving" : "Save to Assets"}</button>
          ))}
        <button type="button" className="ghost" onClick={onBack}>Try another effect</button>
      </div>
    </div>
  );
}
