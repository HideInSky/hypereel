import { useId, useState } from "react";
import { ApiError, type SheetChange } from "./api";

export const OUTFIT_PRESETS = ["Winter coat and beanie", "Smart casual (white tee, navy blazer)", "Desert linen and wide-brim hat", "Rain jacket", "Charcoal suit"];
export const STYLE_PRESETS = ["Anime", "3D animated film", "Pixel art", "Comic book ink", "Claymation"];
const MAX = 200;

type Props = {
  /** Make the new sheet. Throws ApiError with a message to show. */
  onMake: (change: SheetChange) => Promise<void>;
};

/** "New outfit" and "New art style" for a character or a sheet: pick a preset or describe one. */
export default function SheetChanges({ onMake }: Props) {
  const [what, setWhat] = useState<"outfit" | "style" | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const presets = what === "style" ? STYLE_PRESETS : OUTFIT_PRESETS;

  const open = (next: "outfit" | "style") => {
    setWhat((cur) => (cur === next ? null : next));
    setText("");
    setError(null);
  };

  const submit = async () => {
    const value = text.trim();
    if (!what || !value) return;
    setBusy(true);
    setError(null);
    try {
      await onMake(what === "outfit" ? { outfit: value } : { style: value });
      setWhat(null);
      setText("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start the new sheet. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-changes">
      <div className="inspector-actions">
        <button type="button" className={`ghost${what === "outfit" ? " is-on" : ""}`} aria-expanded={what === "outfit"} onClick={() => open("outfit")}>New outfit</button>
        <button type="button" className={`ghost${what === "style" ? " is-on" : ""}`} aria-expanded={what === "style"} onClick={() => open("style")}>New art style</button>
      </div>
      {what && (
        <form
          className="sheet-change-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="chips" role="group" aria-label={what === "outfit" ? "Outfit ideas" : "Art style ideas"}>
            {presets.map((p) => (
              <button key={p} type="button" className={`chip${text === p ? " chip--on" : ""}`} aria-pressed={text === p} onClick={() => setText(p)}>{p}</button>
            ))}
          </div>
          <label className="story-field" htmlFor={fieldId}>
            <span>{what === "outfit" ? "Or describe the outfit" : "Or describe the style"}</span>
          </label>
          <input
            id={fieldId}
            className="text-input"
            type="text"
            maxLength={MAX}
            value={text}
            placeholder={what === "outfit" ? "A red tracksuit and white sneakers" : "Watercolor storybook"}
            onChange={(e) => setText(e.target.value)}
          />
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="inspector-actions">
            <button type="submit" className="primary" disabled={busy || !text.trim()}>{busy ? "Starting" : what === "outfit" ? "Make sheet in this outfit" : "Make sheet in this style"}</button>
            <button type="button" className="ghost" onClick={() => setWhat(null)}>Cancel</button>
          </div>
          <p className="muted small">Makes a new character sheet; this one stays. Uses credits.</p>
        </form>
      )}
    </div>
  );
}
