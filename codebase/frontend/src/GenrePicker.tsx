import type { Genre } from "./api";

type Props = {
  genres: Genre[];
  value: string | null;
  onChange: (id: string) => void;
};

/** Horizontal row of genre chips. The selected chip also shows its tagline below. */
export default function GenrePicker({ genres, value, onChange }: Props) {
  const selected = genres.find((g) => g.id === value) ?? null;

  if (genres.length === 0) {
    return <p className="muted small">Loading genres…</p>;
  }

  return (
    <div className="genre-picker">
      <div className="chip-row" role="radiogroup" aria-label="Genre">
        {genres.map((g) => (
          <button
            key={g.id}
            type="button"
            role="radio"
            aria-checked={g.id === value}
            className={"chip" + (g.id === value ? " chip--on" : "")}
            onClick={() => onChange(g.id)}
          >
            <span className="chip-emoji" aria-hidden="true">
              {g.emoji}
            </span>
            {g.label}
          </button>
        ))}
      </div>
      {/* Reserve the space even when nothing is selected so the layout doesn't jump. */}
      <p className="tagline" aria-live="polite">
        {selected ? selected.tagline : "Pick a genre."}
      </p>
    </div>
  );
}
