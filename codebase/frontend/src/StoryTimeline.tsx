import { useEffect, useRef, type CSSProperties } from "react";
import type { Shot, ShotMode, ShotSide, Story } from "./api";
import { LAYER_KIND_LABEL, clock, layerKind, secondsText, shotStarts, storyLength } from "./useStory";

/** Width of one second on the timeline. Shots and sound share this scale. */
export const PX_PER_SECOND = 28;

export type Selection =
  | { kind: "shot"; id: string }
  | { kind: "layer"; id: string }
  | { kind: "new"; anchorId: string; side: ShotSide }
  | { kind: "sound" }
  | null;

export const MODE_LABEL: Record<ShotMode, string> = { original: "Original", continue: "Continue", restage: "Restage" };

type Props = {
  story: Story;
  selection: Selection;
  onSelect: (next: Selection) => void;
  /** Where the preview is, in story seconds. */
  time: number;
};

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Shots end to end, a ruler above and one row per sound layer below, all on one time scale. */
export default function StoryTimeline({ story, selection, onSelect, time }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const starts = shotStarts(story);
  const total = Math.max(1, storyLength(story));
  const width = Math.ceil(total * PX_PER_SECOND);
  const first = story.shots[0];
  const last = story.shots.at(-1);
  const selectedId = selection?.kind === "shot" || selection?.kind === "layer" ? selection.id : null;

  // Keep the selected shot or layer in view, e.g. a new shot added at the far end.
  useEffect(() => {
    if (!selectedId) return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(selectedId)}"]`);
    el?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest", inline: "nearest" });
  }, [selectedId]);

  const ticks = Array.from({ length: Math.floor(total) + 1 }, (_, i) => i);
  const px = (seconds: number) => seconds * PX_PER_SECOND;

  return (
    <div className="timeline" ref={scroller}>
      <div className="tl-grid" style={{ gridTemplateColumns: `var(--tl-side) ${width}px var(--tl-side)` }}>
        <div className="tl-ruler" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className={t % 5 === 0 ? "tl-tick tl-tick--major" : "tl-tick"} style={{ left: px(t) }}>
              {t % 5 === 0 && <span>{clock(t)}</span>}
            </span>
          ))}
        </div>

        {first && (
          <button type="button" className="tl-add tl-add--before" aria-label="Add a shot before the first shot" onClick={() => onSelect({ kind: "new", anchorId: first.id, side: "before" })}>
            <span aria-hidden="true">+</span> Before
          </button>
        )}

        <ol className="tl-shots" aria-label="Shots">
          {story.shots.map((shot) => (
            <li key={shot.id} style={{ width: px(shot.seconds) }}>
              <ShotCard shot={shot} start={starts[shot.id] ?? 0} on={selectedId === shot.id} onClick={() => onSelect({ kind: "shot", id: shot.id })} />
            </li>
          ))}
        </ol>

        {last && (
          <button type="button" className="tl-add tl-add--after" aria-label="Add a shot after the last shot" onClick={() => onSelect({ kind: "new", anchorId: last.id, side: "after" })}>
            <span aria-hidden="true">+</span> After
          </button>
        )}

        <div className="tl-lanes" role="group" aria-label="Sound layers">
          {story.audio.length === 0 ? (
            <button type="button" className="tl-lane-empty" onClick={() => onSelect({ kind: "sound" })}>No sound layers yet</button>
          ) : (
            story.audio.map((layer) => {
              const kind = layerKind(layer, story.clips);
              const clip = "clipId" in layer.source ? story.clips[layer.source.clipId] : undefined;
              const start = Math.min(layer.start, total);
              const span = Math.max(0, Math.min(layer.length ?? total - start, total - start));
              // Without looping, a sound shorter than its bar goes quiet partway.
              const sourceSeconds = clip?.seconds ?? null;
              const heard = layer.loop || !sourceSeconds ? span : Math.min(span, sourceSeconds);
              const making = clip && (clip.status === "queued" || clip.status === "running");
              const failed = clip?.status === "failed";
              const style = { left: px(start), width: Math.max(px(span), 12), "--heard": span ? `${(heard / span) * 100}%` : "100%" } as CSSProperties;
              return (
                <div className="tl-lane" key={layer.id}>
                  <button
                    type="button"
                    data-id={layer.id}
                    className={`tl-bar tl-bar--${kind}${selectedId === layer.id ? " tl-bar--on" : ""}${making ? " tl-bar--making" : ""}${failed ? " tl-bar--failed" : ""}`}
                    style={style}
                    aria-pressed={selectedId === layer.id}
                    aria-label={`${layer.label}, ${LAYER_KIND_LABEL[kind]}, from ${clock(layer.start)} ${layer.length == null ? "to the end" : `for ${secondsText(layer.length)}`}${making ? ", still being made" : ""}${failed ? ", failed" : ""}`}
                    onClick={() => onSelect({ kind: "layer", id: layer.id })}
                  >
                    <span className="tl-bar-label">{making ? `Making ${layer.label}` : layer.label}</span>
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="tl-playhead" aria-hidden="true">
          <span style={{ transform: `translateX(${px(Math.min(time, total))}px)` }} />
        </div>
      </div>
    </div>
  );
}

function ShotCard({ shot, start, on, onClick }: { shot: Shot; start: number; on: boolean; onClick: () => void }) {
  const working = shot.status === "queued" || shot.status === "running";
  const failed = shot.status === "failed";
  const state = working ? ", rendering" : failed ? ", didn't render" : "";
  return (
    <button
      type="button"
      data-id={shot.id}
      className={`tl-shot${on ? " tl-shot--on" : ""}${failed ? " tl-shot--failed" : ""}`}
      aria-pressed={on}
      aria-label={`${shot.mode === "original" ? "The clip" : `${MODE_LABEL[shot.mode]} shot`}, ${secondsText(shot.seconds)}, starts at ${clock(start)}${state}`}
      onClick={onClick}
    >
      <span className="tl-shot-frame">
        {shot.videoUrl ? (
          <video muted playsInline preload="metadata" src={`${shot.videoUrl}#t=0.4`} tabIndex={-1} />
        ) : (
          shot.posterUrl && <img src={shot.posterUrl} alt="" />
        )}
        <span className={`tl-shot-mode tl-shot-mode--${shot.mode}`}>{MODE_LABEL[shot.mode]}</span>
        <span className="tl-shot-secs">{Math.round(shot.seconds * 10) / 10}s</span>
        {working && (
          <span className="tl-shot-state">
            Rendering
            <span className="tl-shot-progress"><span style={{ width: `${Math.max(4, shot.progress)}%` }} /></span>
          </span>
        )}
        {failed && <span className="tl-shot-state tl-shot-state--failed">Didn't render</span>}
      </span>
    </button>
  );
}
