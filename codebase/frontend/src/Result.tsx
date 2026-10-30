import { useRef, useState } from "react";
import type { Generation, Genre } from "./api";

type Props = {
  gen: Generation;
  genres: Genre[];
  onRemix: () => void;
  onFresh: () => void;
  showToast: (msg: string) => void;
};

/** The finished clip: tap to play WITH sound, then share / remix / download. */
export default function Result({ gen, genres, onRemix, onFresh, showToast }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const genre = genres.find((g) => g.id === gen.genre);
  const title = `${genre?.emoji ?? "🎬"} ${genre?.label ?? gen.genre}${gen.caption ? `: ${gen.caption}` : ""}`;

  // The audio IS the joke, so we never autoplay muted: the user taps once and
  // we start playback unmuted (browsers allow sound after a user gesture).
  async function play() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    try {
      await v.play();
      setStarted(true);
    } catch {
      // Playback blocked (rare): fall back to native controls.
      setStarted(true);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(gen.shareUrl);
      showToast("Link copied");
    } catch {
      window.prompt("Copy this link:", gen.shareUrl);
    }
  }

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text: "Look what hypereel did to my photo 🎬", url: gen.shareUrl });
        return;
      } catch {
        // User cancelled the share sheet, or sharing failed: fall through to copying.
      }
    }
    await copyLink();
  }

  return (
    <section className="card result">
      <h2 className="title">{title}</h2>

      <div className="player">
        <video
          ref={videoRef}
          src={gen.videoUrl ?? undefined}
          poster={gen.posterUrl ?? undefined}
          playsInline
          loop
          preload="metadata"
          controls={started}
        />
        {!started && (
          <button type="button" className="play-overlay" onClick={() => void play()}>
            <span className="play-btn">▶ Play with sound</span>
            <span className="small">🔊 Turn your volume up</span>
          </button>
        )}
      </div>

      {gen.script && (
        <details className="script">
          <summary>📝 Read the script the AI wrote</summary>
          <p>{gen.script}</p>
        </details>
      )}

      <div className="actions">
        <button type="button" className="btn btn--primary" onClick={() => void share()}>
          Share
        </button>
        <button type="button" className="btn" onClick={() => void copyLink()}>
          Copy link
        </button>
        <a className="btn" href={gen.videoUrl ?? "#"} download={`hypereel-${gen.id}.mp4`}>
          Download
        </a>
      </div>

      <div className="actions actions--stack">
        <button type="button" className="btn btn--gold" onClick={onRemix}>
          🔁 Remix: same photo, new genre
        </button>
        <button type="button" className="btn btn--ghost" onClick={onFresh}>
          ✨ Make your own
        </button>
      </div>

      <p className="credit">Made with MiniMax H3 on ComfyUI</p>
    </section>
  );
}
