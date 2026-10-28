import { useEffect, useState } from "react";
import { fetchFeed, type Generation, type Genre } from "./api";

type Props = {
  genres: Genre[];
  onOpen: (id: string) => void;
};

/** "Fresh off the set": the latest finished clips, as a grid of poster thumbnails. */
export default function Gallery({ genres, onOpen }: Props) {
  const [items, setItems] = useState<Generation[]>([]);

  useEffect(() => {
    fetchFeed()
      .then((rows) => setItems(rows.filter((g) => g.posterUrl)))
      .catch(() => setItems([])); // a broken feed shouldn't break the page
  }, []);

  if (items.length === 0) return null; // nothing to show yet: hide the section entirely

  const emojiFor = (id: string) => genres.find((g) => g.id === id)?.emoji ?? "🎬";

  return (
    <section className="gallery">
      <h2>Fresh off the set</h2>
      <div className="grid">
        {items.map((g) => (
          <button
            key={g.id}
            type="button"
            className="thumb"
            onClick={() => onOpen(g.id)}
            aria-label={`Watch: ${g.caption ?? g.genre}`}
          >
            <img src={g.posterUrl ?? ""} alt="" loading="lazy" />
            <span className="thumb-badge" aria-hidden="true">
              {emojiFor(g.genre)}
            </span>
            {g.caption && <span className="thumb-caption">{g.caption}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
