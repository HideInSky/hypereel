import { useState } from "react";
import { ApiError, generateAsset, makeSheet, makeVideo, uploadAsset, type Asset, type Canvas, type CanvasVideo, type Effect } from "./api";
import UploadCard from "./UploadCard";
import SaveToAssets from "./SaveToAssets";
import SheetChanges from "./SheetChanges";
import { ASPECT_RATIOS, RESOLUTIONS } from "./Sidebar";
import { PersonIcon, PinIcon } from "./Icons";
import { PROMPT_MAX } from "./textLimits";

const KIND_LABEL: Record<Asset["kind"], string> = { image: "Image", character: "Character", sheet: "Character sheet" };
const MAX_REFS = 4;
const MAX_CHARACTERS = 4;
const MAX_VIDEO_IMAGES = 9;
const LENGTHS = [5, 6, 8];

const message = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const ready = (canvas: Canvas) => canvas.assets.filter((a) => a.status === "succeeded" && a.images.length > 0);
export const assetWorking = (a: Asset) => a.status === "queued" || a.status === "running";

/** Pick up to `max` finished assets, shown as small thumbnails. */
function AssetPicker({ assets, picked, max, onChange, label }: { assets: Asset[]; picked: string[]; max: number; onChange: (ids: string[]) => void; label: string }) {
  if (!assets.length) return <p className="muted small">Add an image or a character first; it shows up here.</p>;
  return (
    <div className="picker" role="group" aria-label={label}>
      {assets.map((a) => {
        const on = picked.includes(a.id);
        return (
          <button
            key={a.id}
            type="button"
            className={`picker-item${on ? " picker-item--on" : ""}`}
            aria-pressed={on}
            disabled={!on && picked.length >= max}
            onClick={() => onChange(on ? picked.filter((id) => id !== a.id) : [...picked, a.id])}
          >
            <img src={a.images[0]} alt="" draggable={false} />
            <span>{a.name}</span>
          </button>
        );
      })}
    </div>
  );
}

type AssetFormProps = {
  canvas: Canvas;
  kind: "image" | "character";
  /** Assets to start with as references. */
  preset: string[];
  onDone: (next: Canvas) => void;
  onCancel: () => void;
};

/** Add an image or a character: upload photos (free), or describe one and generate it (uses credits). */
export function AssetForm({ canvas, kind, preset, onDone, onCancel }: AssetFormProps) {
  const [how, setHow] = useState<"upload" | "generate">(preset.length ? "generate" : "upload");
  const [name, setName] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [prompt, setPrompt] = useState("");
  const [refs, setRefs] = useState<string[]>(preset);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const character = kind === "character";
  const fallbackName = character ? "Character" : "Image";

  const submit = async () => {
    setSending(true);
    setError(null);
    try {
      if (how === "upload") {
        const label = name.trim() || photos[0]?.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 40) || fallbackName;
        onDone(await uploadAsset(canvas.id, kind, label, photos));
      } else {
        const label = name.trim() || prompt.trim().split(/\s+/).slice(0, 4).join(" ") || fallbackName;
        onDone(await generateAsset(canvas.id, { kind, name: label, prompt, sourceIds: refs }));
      }
    } catch (err) {
      setError(message(err, `Couldn't add the ${character ? "character" : "image"}. Try again.`));
    } finally {
      setSending(false);
    }
  };

  const canSend = how === "upload" ? photos.length > 0 : prompt.trim().length > 0;

  return (
    <form
      className="inspector-body"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3 className="inspector-title">{character ? "Add a character" : "Add an image"}</h3>
      <div className="segmented" role="group" aria-label="How to add it">
        <button type="button" aria-pressed={how === "upload"} className={how === "upload" ? "on" : ""} onClick={() => setHow("upload")}>{character ? "Upload photos" : "Upload"}</button>
        <button type="button" aria-pressed={how === "generate"} className={how === "generate" ? "on" : ""} onClick={() => setHow("generate")}>{character ? "Describe a person" : "Generate"}</button>
      </div>

      <label className="story-field">
        <span>Name</span>
        <input type="text" maxLength={40} value={name} placeholder={character ? "Mia" : "Rooftop at dusk"} onChange={(e) => setName(e.target.value)} />
      </label>

      {how === "upload" ? (
        <div className="story-field">
          <span>{character ? "Photos of the same person" : "Photo"}</span>
          <UploadCard title={character ? "Character" : "Image"} icon={character ? <PersonIcon /> : <PinIcon />} max={character ? 4 : 1} files={photos} onChange={setPhotos} onError={setError} />
          <small className="muted">Uploading is free. Only upload photos you have the right to use.</small>
        </div>
      ) : (
        <>
          <label className="story-field">
            <span>{character ? "Describe them" : "Describe the image"}</span>
            <textarea
              rows={4}
              maxLength={PROMPT_MAX}
              value={prompt}
              placeholder={character ? "A woman in her 30s with short silver hair and a yellow raincoat" : "A quiet rooftop garden at dusk, city lights behind"}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </label>
          <div className="story-field">
            <span>References (optional, up to {MAX_REFS})</span>
            <AssetPicker assets={ready(canvas)} picked={refs} max={MAX_REFS} onChange={setRefs} label="References" />
          </div>
        </>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="inspector-actions">
        <button type="submit" className="primary" disabled={!canSend || sending}>
          {sending ? "Adding" : how === "upload" ? "Add to the board" : "Generate"}
        </button>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
      {how === "generate" && <p className="muted small">Uses credits.</p>}
    </form>
  );
}

type Role = "character" | "location" | "product";
const ROLE_LABEL: Record<Role, string> = { character: "Character", location: "Location", product: "Product" };

type VideoFormProps = {
  canvas: Canvas;
  effects: Effect[];
  /** Assets to start with as characters. */
  preset: string[];
  onDone: (next: Canvas) => void;
  onCancel: () => void;
};

/** Make a video from cards on the board, with an effect or a free prompt. Uses credits. */
export function VideoForm({ canvas, effects, preset, onDone, onCancel }: VideoFormProps) {
  const assets = ready(canvas);
  const [source, setSource] = useState<"effect" | "prompt">("effect");
  const [effect, setEffect] = useState(effects[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [roles, setRoles] = useState<Record<string, Role>>(() => Object.fromEntries(preset.filter((id) => assets.some((a) => a.id === id)).map((id) => [id, "character" as Role])));
  const [resolution, setResolution] = useState(RESOLUTIONS[0] ?? "480P");
  const [aspectRatio, setAspectRatio] = useState(ASPECT_RATIOS[0] ?? "9:16");
  const [seconds, setSeconds] = useState(6);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ids = (role: Role) => assets.filter((a) => roles[a.id] === role).map((a) => a.id);
  const characters = ids("character");
  const photoCount = assets.filter((a) => roles[a.id]).reduce((n, a) => n + Math.max(1, a.images.length), 0);
  const problem =
    characters.length === 0
      ? "Pick at least one card as the character."
      : characters.length > MAX_CHARACTERS
        ? `Use up to ${MAX_CHARACTERS} character cards.`
        : photoCount > MAX_VIDEO_IMAGES
          ? `That's ${photoCount} photos; a video takes up to ${MAX_VIDEO_IMAGES}. Leave a card out.`
          : source === "prompt" && !prompt.trim()
            ? "Describe what happens in the video."
            : source === "effect" && !effect
              ? "Pick an effect."
              : null;

  const setRole = (id: string, role: Role | "") =>
    setRoles((r) => {
      const next = { ...r };
      if (role) next[id] = role;
      else delete next[id];
      return next;
    });

  const submit = async () => {
    if (problem) return setError(problem);
    setSending(true);
    setError(null);
    try {
      onDone(
        await makeVideo(canvas.id, {
          effect: source === "effect" ? effect : undefined,
          prompt: prompt.trim() || undefined,
          characters,
          locations: ids("location"),
          products: ids("product"),
          resolution,
          aspectRatio,
          seconds: source === "prompt" ? seconds : undefined,
        }),
      );
    } catch (err) {
      setError(message(err, "Couldn't start the video. Try again."));
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className="inspector-body"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3 className="inspector-title">Make a video</h3>
      <div className="segmented" role="group" aria-label="Start from">
        <button type="button" aria-pressed={source === "effect"} className={source === "effect" ? "on" : ""} onClick={() => setSource("effect")}>Use an effect</button>
        <button type="button" aria-pressed={source === "prompt"} className={source === "prompt" ? "on" : ""} onClick={() => setSource("prompt")}>Write a prompt</button>
      </div>

      {source === "effect" && (
        <label className="story-field">
          <span>Effect</span>
          <select value={effect} onChange={(e) => setEffect(e.target.value)}>
            {effects.map((fx) => <option key={fx.id} value={fx.id}>{fx.label}</option>)}
          </select>
        </label>
      )}
      <label className="story-field">
        <span>{source === "effect" ? "Extra direction (optional)" : "What happens"}</span>
        <textarea
          rows={3}
          maxLength={PROMPT_MAX}
          value={prompt}
          placeholder={source === "effect" ? "Make it raining, or give them a red coat" : "She walks through the market, stops and smiles at the camera"}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>

      <fieldset className="roles">
        <legend>Cards to use</legend>
        {assets.length ? (
          assets.map((a) => (
            <label key={a.id} className="role-row">
              <img src={a.images[0]} alt="" draggable={false} />
              <span className="role-name">
                {a.name}
                <small className="muted">{KIND_LABEL[a.kind]}{a.images.length > 1 ? `, ${a.images.length} photos` : ""}</small>
              </span>
              <select aria-label={`Use ${a.name} as`} value={roles[a.id] ?? ""} onChange={(e) => setRole(a.id, e.target.value as Role | "")}>
                <option value="">Not used</option>
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </label>
          ))
        ) : (
          <p className="muted small">Add a character to the board first.</p>
        )}
        <p className={`small ${photoCount > MAX_VIDEO_IMAGES ? "form-error" : "muted"}`}>Uses {photoCount} of {MAX_VIDEO_IMAGES} photos.</p>
      </fieldset>

      <div className="story-field-pair">
        <label className="story-field">
          <span>Resolution</span>
          <select value={resolution} onChange={(e) => setResolution(e.target.value)}>
            {RESOLUTIONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="story-field">
          <span>Aspect ratio</span>
          <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
            {ASPECT_RATIOS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
      </div>
      {source === "prompt" && (
        <label className="story-field">
          <span>Length</span>
          <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
            {LENGTHS.map((s) => <option key={s} value={s}>{s} seconds</option>)}
          </select>
        </label>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="inspector-actions">
        <button type="submit" className="primary" disabled={sending || !!problem}>{sending ? "Starting" : "Make video"}</button>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
      <p className="muted small">{problem && !error ? `${problem} ` : ""}Uses credits.</p>
    </form>
  );
}

type DeleteProps = { confirming: boolean; setConfirming: (on: boolean) => void; onDelete: () => Promise<void>; what: string };

/** A delete button that asks once. Pressing Delete on the board opens the same question. */
function DeleteControl({ confirming, setConfirming, onDelete, what }: DeleteProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!confirming) return <button type="button" className="ghost danger align-start" onClick={() => setConfirming(true)}>Delete {what}</button>;
  return (
    <div className="confirm" role="group" aria-label="Confirm delete">
      <p className="small">Delete this {what} from the board? This can't be undone.</p>
      <div className="inspector-actions">
        <button
          type="button"
          className="ghost danger"
          autoFocus
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onDelete();
            } catch (err) {
              setError(message(err, "Couldn't delete it. Try again."));
              setBusy(false);
            }
          }}
        >
          {busy ? "Deleting" : `Delete ${what}`}
        </button>
        <button type="button" className="ghost" onClick={() => setConfirming(false)}>Keep it</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

type AssetDetailsProps = {
  canvas: Canvas;
  asset: Asset;
  confirming: boolean;
  setConfirming: (on: boolean) => void;
  onDelete: () => Promise<void>;
  onChanged: (next: Canvas) => void;
  onUseAsReference: () => void;
  onMakeVideo: () => void;
  /** It was saved to Assets as this item. */
  onSaved: (libraryId: string) => void;
};

export function AssetDetails({ canvas, asset, confirming, setConfirming, onDelete, onChanged, onUseAsReference, onMakeVideo, onSaved }: AssetDetailsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owner = canvas.isOwner;
  const done = asset.status === "succeeded";
  const sources = asset.sources.map((id) => canvas.assets.find((a) => a.id === id)?.name).filter(Boolean);

  const sheet = async () => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await makeSheet(canvas.id, asset.id));
    } catch (err) {
      setError(message(err, "Couldn't start the character sheet. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inspector-body">
      <span className={`kind-tag kind-tag--asset-${asset.kind}`}>{KIND_LABEL[asset.kind]}</span>
      <h3 className="inspector-title">{asset.name}</h3>
      {assetWorking(asset) && <p className="muted small">Making it now. It appears on the card when it's ready.</p>}
      {asset.status === "failed" && <p className="form-error">{asset.error ?? "This one didn't work."} Delete it and try different words or photos.</p>}
      {asset.images.length > 0 && (
        <div className={`asset-images${asset.images.length === 1 ? " asset-images--one" : ""}`}>
          {asset.images.map((src, i) => <img key={src} src={src} alt={`${asset.name}, picture ${i + 1}`} />)}
        </div>
      )}
      {asset.prompt && <p className="small shot-prompt">{asset.prompt}</p>}
      {sources.length > 0 && <p className="muted small">Made from {sources.join(", ")}.</p>}

      {owner && done && (
        <div className="inspector-actions inspector-actions--stack">
          {asset.kind === "character" && (
            <button type="button" className="ghost" disabled={busy} onClick={() => void sheet()}>{busy ? "Starting" : "Make a character sheet"}</button>
          )}
          <button type="button" className="ghost" onClick={onMakeVideo}>Make a video with it</button>
          <button type="button" className="ghost" onClick={onUseAsReference}>Use it as a reference</button>
        </div>
      )}
      {owner && done && asset.kind === "character" && <p className="muted small">A character sheet is one image with front, side, back and close-ups. Uses credits.</p>}
      {owner && done && (asset.kind === "character" || asset.kind === "sheet") && (
        <SheetChanges onMake={async (change) => onChanged(await makeSheet(canvas.id, asset.id, change))} />
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      {owner && done && <SaveToAssets source={{ from: "asset", canvasId: canvas.id, assetId: asset.id }} kind={asset.kind} savedId={asset.savedId ?? null} onSaved={onSaved} />}
      {owner && <DeleteControl confirming={confirming} setConfirming={setConfirming} onDelete={onDelete} what={asset.kind === "sheet" ? "sheet" : asset.kind} />}
    </div>
  );
}

type VideoDetailsProps = {
  canvas: Canvas;
  video: CanvasVideo;
  confirming: boolean;
  setConfirming: (on: boolean) => void;
  onDelete: () => Promise<void>;
  /** Open the story strip, optionally straight into adding a shot on one side. */
  onStory: (side?: "before" | "after") => Promise<void>;
  /** It was saved to Assets as this item. */
  onSaved: (libraryId: string) => void;
};

export function VideoDetails({ canvas, video, confirming, setConfirming, onDelete, onStory, onSaved }: VideoDetailsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owner = canvas.isOwner;
  const done = video.status === "succeeded" && !!video.videoUrl;
  const working = video.status === "queued" || video.status === "running";
  const inputs = video.assetIds.map((id) => canvas.assets.find((a) => a.id === id)?.name).filter(Boolean);

  const story = async (side?: "before" | "after") => {
    setBusy(true);
    setError(null);
    try {
      await onStory(side);
    } catch (err) {
      setError(message(err, "Couldn't open the story. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inspector-body">
      <span className="kind-tag">Video</span>
      <h3 className="inspector-title">{video.effectLabel}</h3>
      {done && <video className="inspector-video" src={video.videoUrl ?? undefined} poster={video.posterUrl ?? undefined} controls playsInline preload="metadata" />}
      {working && (
        <>
          <div className="progress" role="progressbar" aria-label="Rendering" aria-valuenow={Math.max(4, video.progress)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${Math.max(4, video.progress)}%` }} />
          </div>
          <p className="muted small">Rendering. Usually about a minute; you can keep working.</p>
        </>
      )}
      {video.status === "failed" && <p className="form-error">{video.error ?? "This video didn't render."} Try different cards or words.</p>}
      {video.prompt && <p className="small shot-prompt">{video.prompt}</p>}
      {inputs.length > 0 && <p className="muted small">Made from {inputs.join(", ")}.</p>}

      {done && (
        <div className="inspector-actions inspector-actions--stack">
          {owner && (
            <div className="inspector-actions">
              <button type="button" className="ghost" disabled={busy} onClick={() => void story("before")}>Add a shot before</button>
              <button type="button" className="ghost" disabled={busy} onClick={() => void story("after")}>Add a shot after</button>
            </div>
          )}
          {(owner || video.storyId) && <button type="button" className="ghost" disabled={busy} onClick={() => void story()}>{video.storyId ? "Open its story" : "Start a story"}</button>}
          <a className="ghost" href={video.videoUrl ?? "#"} download={`hypereel-${video.id}.mp4`}>Download this clip</a>
        </div>
      )}
      {owner && done && <p className="muted small">New shots join this video's story, shown as a row on the board. Each new shot uses credits.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {owner && done && <SaveToAssets source={{ from: "video", generationId: video.id }} kind="video" savedId={video.savedId ?? null} onSaved={onSaved} />}
      {owner && <DeleteControl confirming={confirming} setConfirming={setConfirming} onDelete={onDelete} what="video" />}
    </div>
  );
}
