import { useEffect, useRef, useState } from "react";

/**
 * A muted looping clip that loads only near the viewport and plays only while
 * visible, so a long gallery doesn't download every video at once.
 */
export default function LazyClip({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setNear(true);
          void video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return <video ref={ref} src={near ? src : undefined} muted loop playsInline autoPlay preload="metadata" />;
}
