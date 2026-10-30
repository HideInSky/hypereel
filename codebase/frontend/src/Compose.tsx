import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { ApiError, createGeneration, fetchGeneration, fetchPosterAsFile, type Generation, type Genre } from "./api";
import GenrePicker from "./GenrePicker";
import Gallery from "./Gallery";

const CAPTION_MAX = 120;
const MAX_BYTES = 10 * 1024 * 1024;

type Props = {
  genres: Genre[];
  /** When set, we load that generation's photo and pre-select a different genre. */
  remixId: string | null;
  onSubmitted: (gen: Generation) => void;
  onOpen: (id: string) => void;
};

export default function Compose({ genres, remixId, onSubmitted, onOpen }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [genre, setGenre] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [remixLoading, setRemixLoading] = useState(Boolean(remixId));
  const inputRef = useRef<HTMLInputElement>(null);

  // Build a preview URL for the chosen file, and free it when it changes.
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Remix flow: fetch the old generation and turn its poster into a File so
  // the rest of the form treats it like a freshly picked photo. We remember
  // the old genre so we can pre-select a *different* one below.
  const [remixGenre, setRemixGenre] = useState<string | null>(null);
  useEffect(() => {
    if (!remixId) return;
    let cancelled = false;
    (async () => {
      try {
        const old = await fetchGeneration(remixId);
        if (!old.posterUrl) throw new Error("no poster");
        const f = await fetchPosterAsFile(old.posterUrl);
        if (cancelled) return;
        setFile(f);
        setCaption(old.caption ?? "");
        setRemixGenre(old.genre);
      } catch {
        if (!cancelled) setError("Couldn't load the original photo — pick a new one!");
      } finally {
        if (!cancelled) setRemixLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remixId]);

  // Genres and the remix generation load independently; once both are here
  // (and the user hasn't picked anything yet) choose a different genre.
  useEffect(() => {
    if (!remixGenre || genres.length === 0) return;
    setGenre((current) => current ?? pickDifferentGenre(genres, remixGenre));
  }, [remixGenre, genres]);

  function acceptFile(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (!f.type.startsWith("image/") && !/\.heic$/i.test(f.name)) {
      setError("That doesn't look like an image. JPG, PNG, WebP or HEIC please.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("That photo is over 10MB. Try a smaller one.");
      return;
    }
    setFile(f);
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    acceptFile(e.target.files?.[0]);
    e.target.value = ""; // allow re-picking the same file
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    acceptFile(e.dataTransfer.files?.[0]);
  }

  async function submit() {
    if (!file || !genre || busy) return;
    setBusy(true);
    setError(null);
    try {
      const gen = await createGeneration({ image: file, genre, caption });
      onSubmitted(gen);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError(`${err.message} 😉`); // rate-limited: the backend's message is already friendly
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
      setBusy(false);
    }
  }

  const canSubmit = Boolean(file && genre) && !busy && !remixLoading;

  return (
    <>
      <section className="hero">
        <h1 className="headline">hypereel</h1>
        <p className="sub">
          Make anything overdramatic. <span className="nowrap">One photo →</span> an 8-second trailer with narrator,
          music &amp; SFX.
        </p>
      </section>

      <section className="card compose">
        {/* Step 1: the photo */}
        <div
          className={"dropzone" + (dragOver ? " dropzone--over" : "") + (preview ? " dropzone--filled" : "")}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          aria-label={preview ? "Change photo" : "Pick a photo"}
        >
          {preview ? (
            <>
              <img src={preview} alt="Your photo" className="preview" />
              <span className="dropzone-hint">Tap to change</span>
            </>
          ) : remixLoading ? (
            <p className="dropzone-empty">Loading your photo…</p>
          ) : (
            <p className="dropzone-empty">
              <span className="big" aria-hidden="true">
                📸
              </span>
              <strong>Tap to pick a photo</strong>
              <span className="muted small">Pet, plant, lunch, mug… anything.</span>
            </p>
          )}
          <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
        </div>

        {/* Step 2: the genre */}
        <GenrePicker genres={genres} value={genre} onChange={setGenre} />

        {/* Step 3: optional note for the AI script writer (a name, a fact, or a line to say) */}
        <label className="field">
          <span className="field-label">
            Tell the writer something <span className="muted">(optional)</span>
            <span className={"counter" + (caption.length >= CAPTION_MAX ? " counter--max" : "")}>
              {caption.length}/{CAPTION_MAX}
            </span>
          </span>
          <input
            type="text"
            value={caption}
            maxLength={CAPTION_MAX}
            placeholder="e.g. Mochi. Has never caught a single mouse."
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </label>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button type="button" className="btn btn--primary btn--big" disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? "Uploading…" : "🎬 Hypereel it"}
        </button>
        <p className="muted small center">An AI writes a new joke for your photo every time. About a minute.</p>
      </section>

      <Gallery genres={genres} onOpen={onOpen} />
    </>
  );
}

/** Any genre except `avoid` (falls back to `avoid` if it's the only one). */
function pickDifferentGenre(genres: Genre[], avoid: string): string | null {
  if (genres.length === 0) return null;
  const others = genres.filter((g) => g.id !== avoid);
  const pool = others.length > 0 ? others : genres;
  return pool[Math.floor(Math.random() * pool.length)]!.id;
}
