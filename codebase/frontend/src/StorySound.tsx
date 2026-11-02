import { useEffect, useRef, useState } from "react";
import { ApiError, MAX_LAYERS, createAudio, fetchSounds, originalAudio, type AudioClip, type Layer, type LibrarySound, type Story } from "./api";
import { MODE_LABEL } from "./StoryTimeline";
import { LAYER_KIND_LABEL, clock, layerKind, newLayerId, secondsText, shotStarts, storyLength } from "./useStory";

type Source = "original" | "music" | "sfx" | "library";

const SOURCES: { id: Source; label: string }[] = [
  { id: "original", label: "Original sound" },
  { id: "music", label: "Music" },
  { id: "sfx", label: "Sound effect" },
  { id: "library", label: "Library" },
];

const round = (n: number, step = 0.1) => Number((Math.round(n / step) * step).toFixed(2));

/** Pick where a new sound layer comes from, then make or fetch it. */
export function AddSound({ story, onAdd }: { story: Story; onAdd: (layer: Layer, clip?: AudioClip) => void }) {
  const total = storyLength(story);
  const starts = shotStarts(story);
  const rendered = story.shots.filter((s) => s.status === "succeeded");
  const [source, setSource] = useState<Source>("original");
  const [shotId, setShotId] = useState(rendered[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [musicSeconds, setMusicSeconds] = useState(() => Math.min(30, Math.max(5, Math.round(total))));
  const [sfxSeconds, setSfxSeconds] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = story.audio.length >= MAX_LAYERS;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add that sound. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const addOriginal = () =>
    run(async () => {
      const shot = rendered.find((s) => s.id === shotId);
      if (!shot) return;
      const clip = await originalAudio(shot.id);
      onAdd({ id: newLayerId(), source: { clipId: clip.id }, label: clip.label || "Original sound", start: round(starts[shot.id] ?? 0), length: round(shot.seconds), volume: 1, loop: false }, clip);
    });

  const make = (kind: "music" | "sfx") =>
    run(async () => {
      const seconds = kind === "music" ? musicSeconds : sfxSeconds;
      const clip = await createAudio(kind, prompt.trim(), seconds);
      const label = clip.label || prompt.trim().slice(0, 40);
      onAdd({ id: newLayerId(), source: { clipId: clip.id }, label, start: 0, length: kind === "music" ? null : seconds, volume: 1, loop: false }, clip);
      setPrompt("");
    });

  const pick = (s: Source) => {
    setSource(s);
    setError(null);
  };

  return (
    <div className="inspector-body">
      <h3 className="inspector-title">Add sound</h3>
      <p className="muted small">Every sound layer plays at the same time, over the whole story.</p>
      <div className="segmented" role="group" aria-label="Kind of sound">
        {SOURCES.map((s) => (
          <button key={s.id} type="button" aria-pressed={source === s.id} className={source === s.id ? "on" : ""} onClick={() => pick(s.id)}>{s.label}</button>
        ))}
      </div>

      {full ? (
        <p className="muted small">A story holds up to {MAX_LAYERS} sound layers. Delete one to add another.</p>
      ) : source === "original" ? (
        rendered.length ? (
          <>
            <label className="story-field">
              <span>Take the sound from</span>
              <select value={shotId} onChange={(e) => setShotId(e.target.value)}>
                {rendered.map((s) => (
                  <option key={s.id} value={s.id}>{s.mode === "original" ? "The clip" : `${MODE_LABEL[s.mode]} shot at ${clock(starts[s.id] ?? 0)}`}</option>
                ))}
              </select>
            </label>
            <p className="muted small">It lines up with that shot. You can move it after.</p>
            <div className="inspector-actions">
              <button type="button" className="primary" disabled={busy || !shotId} onClick={() => void addOriginal()}>{busy ? "Adding" : "Add its sound"}</button>
            </div>
          </>
        ) : (
          <p className="muted small">Once a shot has rendered, you can use its sound here.</p>
        )
      ) : source === "music" || source === "sfx" ? (
        <form
          className="inspector-body inspector-body--flat"
          onSubmit={(e) => {
            e.preventDefault();
            void make(source);
          }}
        >
          <label className="story-field">
            <span>{source === "music" ? "Describe the music" : "Describe the sound"}</span>
            <textarea rows={3} maxLength={300} required value={prompt} placeholder={source === "music" ? "Dreamy lo-fi beat with soft piano" : "Rain on a tin roof"} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          {source === "music" ? (
            <NumberField label="Length in seconds" value={musicSeconds} min={1} max={30} step={1} onChange={setMusicSeconds} />
          ) : (
            <NumberField label="Length in seconds" value={sfxSeconds} min={0.5} max={30} step={0.5} onChange={setSfxSeconds} />
          )}
          <div className="inspector-actions">
            <button type="submit" className="primary" disabled={busy || !prompt.trim()}>{busy ? "Starting" : source === "music" ? "Make music" : "Make sound effect"}</button>
          </div>
          <p className="muted small">Uses credits. The layer fills in when the sound is ready.</p>
        </form>
      ) : (
        <Library onPick={(s) => onAdd({ id: newLayerId(), source: { sound: s.id }, label: s.label, start: 0, length: s.seconds ? round(Math.min(s.seconds, total)) : null, volume: 1, loop: false })} />
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

function Library({ onPick }: { onPick: (sound: LibrarySound) => void }) {
  const [sounds, setSounds] = useState<LibrarySound[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetchSounds().then(setSounds).catch(() => setFailed(true));
    return () => player.current?.pause();
  }, []);

  const toggle = (sound: LibrarySound) => {
    player.current?.pause();
    if (playing === sound.id) return setPlaying(null);
    const audio = new Audio(sound.url);
    audio.onended = () => setPlaying(null);
    player.current = audio;
    void audio.play().catch(() => setPlaying(null));
    setPlaying(sound.id);
  };

  if (failed) return <p className="form-error">Can't load the sound library. Refresh to try again.</p>;
  if (!sounds) return <p className="muted small">Loading sounds</p>;
  if (!sounds.length) {
    return (
      <div className="library-empty">
        <strong>The library is empty for now</strong>
        <p className="muted small">Ready-made sounds will be added here. Until then, describe a sound effect and we'll make it.</p>
      </div>
    );
  }
  return (
    <ul className="library">
      {sounds.map((s) => (
        <li key={s.id}>
          <span className="library-text">
            <strong>{s.label}</strong>
            <span className="muted small">{s.seconds ? secondsText(s.seconds) : "Any length"}. {s.credit}, {s.license}.</span>
          </span>
          <button type="button" className="ghost" aria-label={`${playing === s.id ? "Stop" : "Play"} ${s.label}`} onClick={() => toggle(s)}>{playing === s.id ? "Stop" : "Play"}</button>
          <button type="button" className="ghost" onClick={() => onPick(s)}>Add</button>
        </li>
      ))}
    </ul>
  );
}

type LayerProps = {
  story: Story;
  layer: Layer;
  onChange: (patch: Partial<Layer>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

/** Controls for one sound layer: where it sits, how long, how loud, looping. */
export function LayerPanel({ story, layer, onChange, onDuplicate, onDelete }: LayerProps) {
  const total = storyLength(story);
  const kind = layerKind(layer, story.clips);
  const clip = "clipId" in layer.source ? story.clips[layer.source.clipId] : undefined;
  const making = clip && (clip.status === "queued" || clip.status === "running");
  const url = clip ? clip.url : null;

  return (
    <div className="inspector-body">
      <span className={`kind-tag kind-tag--${kind}`}>{LAYER_KIND_LABEL[kind]}</span>
      <label className="story-field">
        <span>Name</span>
        <input type="text" maxLength={60} value={layer.label} onChange={(e) => onChange({ label: e.target.value })} />
      </label>

      {making && <p className="muted small">Making this sound. It shows up here when it's ready.</p>}
      {clip?.status === "failed" && (
        <p className="form-error" role="alert">{clip.error ?? "This sound couldn't be made."} Delete this layer and try different words.</p>
      )}
      {url && <audio className="layer-audio" controls preload="none" src={url} aria-label={`Listen to ${layer.label}`} />}

      <div className="story-field-pair">
        <NumberField label="Start (seconds)" value={layer.start} min={0} max={Math.max(0, Math.floor(total * 10) / 10)} step={0.5} onChange={(start) => onChange({ start })} />
        {layer.length != null && (
          <NumberField label="Length (seconds)" value={layer.length} min={0.5} max={600} step={0.5} onChange={(length) => onChange({ length })} />
        )}
      </div>
      <label className="story-toggle">
        <span>Play to the end</span>
        <input
          type="checkbox"
          className="switch"
          checked={layer.length == null}
          onChange={(e) => onChange({ length: e.target.checked ? null : round(Math.max(0.5, Math.min(clip?.seconds ?? total, total - layer.start))) })}
        />
      </label>
      <label className="story-field">
        <span className="story-field-head">
          Volume <output>{Math.round(layer.volume * 100)}%</output>
        </span>
        <input type="range" min={0} max={2} step={0.05} value={layer.volume} onChange={(e) => onChange({ volume: Number(e.target.value) })} />
      </label>
      <label className="story-toggle">
        <span>
          Loop
          <small className="muted">Repeats the sound to fill its length.</small>
        </span>
        <input type="checkbox" className="switch" checked={layer.loop} onChange={(e) => onChange({ loop: e.target.checked })} />
      </label>

      <div className="inspector-actions">
        <button type="button" className="ghost" disabled={story.audio.length >= MAX_LAYERS} onClick={onDuplicate}>Duplicate</button>
        <button type="button" className="ghost danger" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

/** A number input that lets you type freely and only reports values in range. */
function NumberField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="story-field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text ?? String(value)}
        onFocus={() => setText(String(value))}
        onBlur={() => setText(null)}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, round(n, 0.01))));
        }}
      />
    </label>
  );
}
