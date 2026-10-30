import { useEffect, useRef, useState } from "react";

// Clips that have finished buffering wait here briefly, then all start on the same
// frame. Without this each tile starts whenever its own download happens to finish.
const waiting = new Set<HTMLVideoElement>();
let timer: number | undefined;
let firstWaiting = 0;
const GATHER_MS = 300; // how long to wait for another clip to become ready
const MAX_GATHER_MS = 1500; // never hold a ready clip longer than this

function flush() {
  window.clearTimeout(timer);
  timer = undefined;
  firstWaiting = 0;
  for (const video of waiting) {
    video.currentTime = 0;
    void video.play().catch(() => {}); // blocked playback just leaves the poster showing
  }
  waiting.clear();
}

function startTogether(video: HTMLVideoElement) {
  waiting.add(video);
  firstWaiting ||= Date.now();
  window.clearTimeout(timer);
  const left = MAX_GATHER_MS - (Date.now() - firstWaiting);
  timer = window.setTimeout(flush, Math.max(0, Math.min(GATHER_MS, left)));
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A muted looping clip. Shows its poster at once, downloads only near the viewport,
 * starts only after it can play through without stalling, and pauses off-screen.
 */
export default function LazyClip({ src, poster }: { src: string; poster: string | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const ready = useRef(false);
  const visible = useRef(false);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // iOS Safari checks the real attribute, and React only sets the property.
    video.muted = true;
    video.setAttribute("muted", "");

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible.current = Boolean(entry?.isIntersecting);
        if (visible.current) {
          setNear(true);
          if (ready.current && !reducedMotion()) void video.play().catch(() => {});
        } else {
          waiting.delete(video);
          video.pause();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(video);
    return () => {
      observer.disconnect();
      waiting.delete(video);
    };
  }, []);

  return (
    <video
      ref={ref}
      src={near ? src : undefined}
      poster={poster ?? undefined}
      muted
      loop
      playsInline
      preload={near ? "auto" : "none"}
      onCanPlayThrough={(e) => {
        if (ready.current) return;
        ready.current = true;
        if (visible.current && !reducedMotion()) startTogether(e.currentTarget);
      }}
    />
  );
}
