import type { LibraryItem } from "./api";
import { itemWorking } from "./useLibrary";

/** The picture part of an Assets tile: a photo, a fan of prints for a character, a letterboxed sheet, or a video. */
export default function LibraryThumb({ item, playOnHover = false }: { item: LibraryItem; playOnHover?: boolean }) {
  const stack = item.kind === "character" && item.images.length > 1;
  let body = null;
  if (item.kind === "video" && item.videoUrl) {
    body = (
      <video
        src={item.images[0] ? item.videoUrl : `${item.videoUrl}#t=0.4`}
        poster={item.images[0]}
        muted
        loop
        playsInline
        preload={item.images[0] ? "none" : "metadata"}
        tabIndex={-1}
        onMouseEnter={playOnHover ? (e) => void e.currentTarget.play().catch(() => {}) : undefined}
        onMouseLeave={playOnHover ? (e) => e.currentTarget.pause() : undefined}
      />
    );
  } else if (stack) {
    body = item.images.slice(0, 3).map((src, i, shown) => {
      const off = i - (shown.length - 1) / 2; // -1..1, centred
      return <img key={src} src={src} alt="" draggable={false} loading="lazy" className="lib-print" style={{ transform: `translateX(${off * 34}%) rotate(${off * 6}deg)`, zIndex: i + 1 }} />;
    });
  } else if (item.images[0]) {
    body = <img src={item.images[0]} alt="" draggable={false} loading="lazy" />;
  }

  return (
    <span className={`lib-frame lib-frame--${item.kind}${stack ? " lib-frame--stack" : ""}`}>
      {body}
      {itemWorking(item) && <span className="lib-status">{item.status === "queued" ? "Waiting to start" : "Making it"}</span>}
      {item.status === "failed" && <span className="lib-status lib-status--failed">Didn't work</span>}
      {item.kind === "video" && item.status === "succeeded" && <span className="lib-play" aria-hidden="true" />}
    </span>
  );
}
