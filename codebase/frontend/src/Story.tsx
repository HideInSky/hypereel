import { useEffect, useRef, useState } from "react";
import { ApiError, MAX_LAYERS, deleteShot, exportStory, type AudioClip, type Layer, type Shot, type Story } from "./api";
import ShotForm from "./ShotForm";
import StoryTimeline, { MODE_LABEL, type Selection } from "./StoryTimeline";
import { AddSound, LayerPanel } from "./StorySound";
import { clock, newLayerId, secondsText, shotStarts, storyBusy, storyLength, useStory } from "./useStory";

type Props = {
  id: string;
  seed: Story | null;
  onBack: () => void;
  /** Full page only: open the story's source clip. */
  onOpenClip?: (id: string) => void;
  toast: (message: string) => void;
  /** Docked under the canvas as a strip: compact header, smaller preview, a close button. */
  docked?: boolean;
  /** Set the selection from outside, e.g. "add a shot after" from the canvas. A new key applies it again. */
  cue?: { selection: Selection; key: number } | null;
  /** Hears every fresh copy of the story, so the canvas can redraw its row of shots. */
  onStory?: (story: Story) => void;
};

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Main-panel story editor: preview, timeline of shots and sound, and an inspector for the selection. */
export default function StoryView({ id, seed, onBack, onOpenClip, toast, docked = false, cue = null, onStory }: Props) {
  const { story, notFound, accept, setLayers, flush, saving, saveError, setSaveError } = useStory(id, seed);
  const [selection, setSelection] = useState<Selection>(null);
  const [time, setTime] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const inspector = useRef<HTMLElement>(null);

  useEffect(() => {
    if (story) onStory?.(story);
  }, [story, onStory]);

  const cueKey = cue?.key;
  useEffect(() => {
    if (cue) setSelection(cue.selection);
    // Only a new key re-applies the cue; the selection object itself may be rebuilt.
  }, [cueKey]);

  // On phones the inspector sits under the timeline: bring it up when something is picked.
  useEffect(() => {
    const el = inspector.current;
    if (!selection || !el) return;
    if (el.getBoundingClientRect().top > window.innerHeight - 80) {
      el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    }
  }, [selection]);

  if (notFound) {
    return (
      <div className="stage stage--message">
        <h2>Story not found</h2>
        <button type="button" className="ghost" onClick={onBack}>Back to effects</button>
      </div>
    );
  }
  if (!story) return <div className="stage stage--message"><p className="muted">Loading</p></div>;
  if (!story.isOwner) return <StoryReadOnly story={story} onBack={onBack} backLabel={docked ? "Close" : "Make your own"} />;

  const starts = shotStarts(story);
  const total = storyLength(story);
  const original = story.shots.find((s) => s.mode === "original");
  const ex = story.export;
  const fresh = ex.status === "ready" && !ex.stale && ex.url ? ex.url : null;
  const shotsWorking = story.shots.some((s) => s.status === "queued" || s.status === "running");
  const soundsWorking = !shotsWorking && ex.status !== "rendering" && storyBusy(story);
  const waitReason = shotsWorking ? "Export opens once every shot has rendered." : soundsWorking ? "Export opens once your sounds are ready." : null;

  const nameOf = (shot: Shot) => (shot.mode === "original" ? "the clip" : `the shot at ${clock(starts[shot.id] ?? 0)}`);

  const startExport = async () => {
    setStarting(true);
    setExportError(null);
    try {
      await flush();
      accept(await exportStory(story.id));
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : "Couldn't start the export. Try again.");
    } finally {
      setStarting(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(story.shareUrl);
      toast("Link copied");
    } catch {
      toast(story.shareUrl);
    }
  };

  const addLayer = (layer: Layer, clip?: AudioClip) => {
    setSaveError(null);
    setLayers([...story.audio, layer], { now: true, clip });
    setSelection({ kind: "layer", id: layer.id });
  };
  const changeLayer = (layerId: string, patch: Partial<Layer>) => setLayers(story.audio.map((l) => (l.id === layerId ? { ...l, ...patch } : l)));
  const duplicateLayer = (layer: Layer) => {
    const copy = { ...layer, id: newLayerId(), label: `${layer.label} copy`.slice(0, 60) };
    const at = story.audio.findIndex((l) => l.id === layer.id);
    setLayers([...story.audio.slice(0, at + 1), copy, ...story.audio.slice(at + 1)], { now: true });
    setSelection({ kind: "layer", id: copy.id });
  };
  const removeLayer = (layerId: string) => {
    setLayers(story.audio.filter((l) => l.id !== layerId), { now: true });
    setSelection(null);
  };

  const onShotAdded = (next: Story) => {
    const known = new Set(story.shots.map((s) => s.id));
    accept(next);
    const added = next.shots.find((s) => !known.has(s.id));
    setSelection(added ? { kind: "shot", id: added.id } : null);
  };

  const selectedShot = selection?.kind === "shot" ? story.shots.find((s) => s.id === selection.id) : undefined;
  const selectedLayer = selection?.kind === "layer" ? story.audio.find((l) => l.id === selection.id) : undefined;
  const anchor = selection?.kind === "new" ? story.shots.find((s) => s.id === selection.anchorId) : undefined;

  let panel;
  if (selection?.kind === "new" && anchor) {
    panel = <ShotForm key={`${anchor.id}-${selection.side}`} story={story} anchor={anchor} anchorName={nameOf(anchor)} side={selection.side} onAdded={onShotAdded} onCancel={() => setSelection({ kind: "shot", id: anchor.id })} />;
  } else if (selectedShot) {
    panel = <ShotDetails key={selectedShot.id} story={story} shot={selectedShot} start={starts[selectedShot.id] ?? 0} onSelect={setSelection} onDeleted={(next) => { accept(next); setSelection(null); }} />;
  } else if (selectedLayer) {
    panel = (
      <LayerPanel
        story={story}
        layer={selectedLayer}
        onChange={(patch) => changeLayer(selectedLayer.id, patch)}
        onDuplicate={() => duplicateLayer(selectedLayer)}
        onDelete={() => removeLayer(selectedLayer.id)}
      />
    );
  } else if (selection?.kind === "sound") {
    panel = <AddSound story={story} onAdd={addLayer} />;
  } else {
    const first = story.shots[0];
    const last = story.shots.at(-1);
    panel = (
      <div className="inspector-body">
        <h3 className="inspector-title">Build your story</h3>
        <p className="muted small">Add shots before or after the clip, lay sound over the whole thing, then export one video. Pick a shot or a sound on the timeline to change it.</p>
        <div className="inspector-actions inspector-actions--stack">
          {last && <button type="button" className="ghost" onClick={() => setSelection({ kind: "new", anchorId: last.id, side: "after" })}>Add a shot at the end</button>}
          {first && <button type="button" className="ghost" onClick={() => setSelection({ kind: "new", anchorId: first.id, side: "before" })}>Add a shot at the start</button>}
          <button type="button" className="ghost" onClick={() => setSelection({ kind: "sound" })}>Add sound</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`story${docked ? " story--docked" : ""}`}>
      <header className="story-head">
        <div className="story-heading">
          {original && onOpenClip && !docked && <button type="button" className="story-back" onClick={() => onOpenClip(original.id)}>Back to the clip</button>}
          <h2>{story.title}</h2>
          <p className="muted small">{story.shots.length === 1 ? "1 shot" : `${story.shots.length} shots`}, {secondsText(total)}</p>
        </div>
        <div className="story-export">
          <div className="story-export-buttons">
            {fresh ? (
              <>
                <a className="primary" href={fresh} download={`hypereel-story-${story.id}.mp4`}>Download</a>
                <button type="button" className="ghost" onClick={() => void copyLink()}>Copy link</button>
              </>
            ) : (
              <button type="button" className="primary" disabled={starting || ex.status === "rendering" || !!waitReason} onClick={() => void startExport()}>
                {ex.status === "rendering" || starting ? "Exporting" : ex.status === "ready" ? "Export again" : "Export video"}
              </button>
            )}
            {docked && <button type="button" className="ghost" onClick={onBack}>Close</button>}
          </div>
          <p className="muted small" role="status">
            {ex.status === "rendering"
              ? "Putting your story together. This takes a few seconds."
              : fresh
                ? "Your video is ready."
                : waitReason ?? (ex.status === "ready" && ex.stale ? "You changed the story since the last export." : "Exporting is free.")}
          </p>
          {(exportError || ex.status === "failed") && (
            <p className="form-error" role="alert">{exportError ?? `${ex.error ?? "The export didn't work."} Try exporting again.`}</p>
          )}
        </div>
      </header>

      <div className="story-main">
        <div className="story-stage">
          <Preview story={story} exported={fresh} cue={selectedShot?.id ?? null} onTime={setTime} />

          <section className="story-timeline" aria-labelledby="timeline-title">
            <div className="story-timeline-head">
              <h3 id="timeline-title">Timeline</h3>
              <span className="muted small" aria-live="polite">{saving ? "Saving" : ""}</span>
              <button type="button" className="ghost" disabled={story.audio.length >= MAX_LAYERS} onClick={() => setSelection({ kind: "sound" })}>Add sound</button>
            </div>
            <StoryTimeline story={story} selection={selection} onSelect={setSelection} time={time} />
            {saveError && <p className="form-error" role="alert">{saveError}</p>}
            <p className="muted small">
              {story.audio.length
                ? "The export plays only these sound layers. To keep a shot's own sound, add it as a layer."
                : "The export plays each shot's own sound. Add sound to lay music or effects over the whole story."}
            </p>
          </section>
        </div>

        <aside className="story-inspector" ref={inspector} aria-label="Details">
          {panel}
        </aside>
      </div>
    </div>
  );
}

function ShotDetails({ story, shot, start, onSelect, onDeleted }: { story: Story; shot: Shot; start: number; onSelect: (s: Selection) => void; onDeleted: (next: Story) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const working = shot.status === "queued" || shot.status === "running";
  const ready = shot.status === "succeeded";

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      onDeleted(await deleteShot(story.id, shot.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete the shot. Try again.");
      setDeleting(false);
    }
  };

  return (
    <div className="inspector-body">
      <span className={`kind-tag kind-tag--${shot.mode}`}>{MODE_LABEL[shot.mode]}</span>
      <h3 className="inspector-title">{shot.mode === "original" ? "The clip" : `${MODE_LABEL[shot.mode]} shot`}</h3>
      <p className="muted small">
        {shot.mode === "original"
          ? "The clip this story started from."
          : shot.mode === "continue"
            ? "Joins its neighbour with no visible cut."
            : "Same moves as its neighbour, in a new scene. The join is a cut."}
      </p>
      <dl className="shot-facts">
        <div><dt>Starts at</dt><dd>{clock(start)}</dd></div>
        <div><dt>Length</dt><dd>{secondsText(shot.seconds)}</dd></div>
      </dl>
      {shot.prompt && <p className="small shot-prompt">{shot.prompt}</p>}

      {working && (
        <>
          <div className="progress" role="progressbar" aria-label="Rendering" aria-valuenow={Math.max(4, shot.progress)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${Math.max(4, shot.progress)}%` }} />
          </div>
          <p className="muted small">Rendering. Usually about a minute; you can keep editing.</p>
        </>
      )}
      {shot.status === "failed" && (
        <>
          <p className="form-error">This shot didn't render. Delete it and try again with different words or photos.</p>
          {shot.error && <details className="error-detail"><summary>Details</summary><p>{shot.error}</p></details>}
        </>
      )}

      <div className="inspector-actions">
        <button type="button" className="ghost" disabled={!ready} onClick={() => onSelect({ kind: "new", anchorId: shot.id, side: "before" })}>Add before</button>
        <button type="button" className="ghost" disabled={!ready} onClick={() => onSelect({ kind: "new", anchorId: shot.id, side: "after" })}>Add after</button>
      </div>
      {!ready && !working && shot.status !== "failed" && <p className="muted small">You can add next to this shot once it has rendered.</p>}

      {shot.mode === "original" ? (
        <p className="muted small">The clip stays in every story, so it can't be deleted.</p>
      ) : confirming ? (
        <div className="confirm" role="group" aria-label="Confirm delete">
          <p className="small">Delete this shot? This can't be undone.</p>
          <div className="inspector-actions">
            <button type="button" className="ghost danger" disabled={deleting} onClick={() => void remove()}>{deleting ? "Deleting" : "Delete shot"}</button>
            <button type="button" className="ghost" onClick={() => setConfirming(false)}>Keep it</button>
          </div>
        </div>
      ) : (
        <button type="button" className="ghost danger align-start" onClick={() => setConfirming(true)}>Delete shot</button>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

/**
 * Plays the exported video, or else the rendered shots one after another in a single
 * <video>, switching to the next shot when one ends. Reports the story time it's at.
 */
function Preview({ story, exported, cue, onTime }: { story: Story; exported: string | null; cue: string | null; onTime: (t: number) => void }) {
  const playable = story.shots.filter((s) => s.status === "succeeded" && s.videoUrl);
  const starts = shotStarts(story);
  const [index, setIndex] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const playNext = useRef(false);
  const current = playable[Math.min(index, playable.length - 1)];
  const cueReady = playable.some((s) => s.id === cue);

  // Picking a shot on the timeline lines the preview up on it.
  useEffect(() => {
    if (!cue || exported) return;
    const at = story.shots.filter((s) => s.status === "succeeded" && s.videoUrl).findIndex((s) => s.id === cue);
    if (at >= 0) {
      playNext.current = false;
      setIndex(at);
    }
    // Only when the pick changes or that shot finishes rendering: polls bring new shot objects and must not jump playback.
  }, [cue, cueReady, exported]);

  const currentId = current?.id;
  useEffect(() => {
    if (currentId) onTime(starts[currentId] ?? 0);
    if (playNext.current) {
      playNext.current = false;
      void video.current?.play().catch(() => {});
    }
  }, [currentId]);

  if (exported) {
    return (
      <div className="story-preview">
        <video src={exported} controls playsInline preload="metadata" onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)} />
        <p className="muted small story-preview-note">Your exported video, with every sound layer mixed in.</p>
      </div>
    );
  }

  return (
    <div className="story-preview">
      {current?.videoUrl ? (
        <video
          ref={video}
          src={current.videoUrl}
          controls
          playsInline
          preload="auto"
          onTimeUpdate={(e) => onTime((starts[current.id] ?? 0) + e.currentTarget.currentTime)}
          onEnded={() => {
            if (index < playable.length - 1) {
              playNext.current = true;
              setIndex(index + 1);
            } else {
              setIndex(0);
            }
          }}
        />
      ) : (
        <p className="muted small story-preview-empty">Your shots play here once they render.</p>
      )}
      <p className="muted small story-preview-note">Plays the shots in order with their own sound. Sound layers are heard after you export.</p>
    </div>
  );
}

/** What someone else sees from a shared story link. */
function StoryReadOnly({ story, onBack, backLabel }: { story: Story; onBack: () => void; backLabel: string }) {
  const url = story.export.status === "ready" ? story.export.url : null;
  const noop = () => {};
  return (
    <div className="stage">
      {url ? (
        <div className="stage-frame">
          <video src={url} controls autoPlay loop playsInline preload="auto" />
        </div>
      ) : (
        <Preview story={story} exported={null} cue={null} onTime={noop} />
      )}
      <h2 className="stage-title">{story.title}</h2>
      <div className="stage-actions">
        <button type="button" className="ghost" onClick={onBack}>{backLabel}</button>
      </div>
    </div>
  );
}
