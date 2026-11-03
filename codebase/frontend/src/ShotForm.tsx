import { useState } from "react";
import { ApiError, addShot, type NewShot, type Shot, type ShotSide, type Story } from "./api";
import UploadCard from "./UploadCard";
import { PersonIcon } from "./Icons";
import { DETAIL_MAX, PROMPT_MAX } from "./textLimits";

const LENGTHS = [5, 6, 8];

type Props = {
  story: Story;
  anchor: Shot;
  /** "the clip" or "the shot at 0:12" */
  anchorName: string;
  side: ShotSide;
  onAdded: (next: Story) => void;
  onCancel: () => void;
};

/** Describe a new shot before or after `anchor` and queue its render. */
export default function ShotForm({ story, anchor, anchorName, side, onAdded, onCancel }: Props) {
  const [shot, setShot] = useState<Omit<NewShot, "anchorId" | "side">>({
    mode: "continue",
    action: "",
    place: "",
    style: "",
    light: "",
    keepMoves: true,
    seconds: 6,
    characters: [],
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof shot>) => {
    setError(null);
    setShot({ ...shot, ...patch });
  };
  const ready = anchor.status === "succeeded";
  const restage = shot.mode === "restage";

  const submit = async () => {
    setSending(true);
    setError(null);
    try {
      onAdded(await addShot(story.id, { ...shot, anchorId: anchor.id, side }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add the shot. Try again.");
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
      <h3 className="inspector-title">Add a shot {side} {anchorName}</h3>

      <fieldset className="mode-pick">
        <legend className="sr-only">Kind of shot</legend>
        <label className={`mode-option${!restage ? " mode-option--on" : ""}`}>
          <input type="radio" name="mode" value="continue" checked={!restage} onChange={() => set({ mode: "continue" })} />
          <span>
            <strong>Continue</strong>
            <span>{side === "after" ? "Picks up exactly where the clip ends." : "Ends exactly where the clip begins."}</span>
          </span>
        </label>
        <label className={`mode-option${restage ? " mode-option--on" : ""}`}>
          <input type="radio" name="mode" value="restage" checked={restage} onChange={() => set({ mode: "restage" })} />
          <span>
            <strong>Restage</strong>
            <span>Same moves, new scene. The join is a cut.</span>
          </span>
        </label>
      </fieldset>

      <label className="story-field">
        <span>What happens</span>
        <textarea rows={3} maxLength={PROMPT_MAX} value={shot.action} placeholder={restage ? "They dance the same steps on a rooftop" : "She turns, laughs and walks out of frame"} onChange={(e) => set({ action: e.target.value })} />
      </label>
      <label className="story-field">
        <span>Place</span>
        <input type="text" maxLength={DETAIL_MAX} value={shot.place} placeholder="A rainy neon street" onChange={(e) => set({ place: e.target.value })} />
      </label>
      <div className="story-field-pair">
        <label className="story-field">
          <span>Style</span>
          <input type="text" maxLength={DETAIL_MAX} value={shot.style} placeholder="35mm film" onChange={(e) => set({ style: e.target.value })} />
        </label>
        <label className="story-field">
          <span>Light</span>
          <input type="text" maxLength={DETAIL_MAX} value={shot.light} placeholder="Golden hour" onChange={(e) => set({ light: e.target.value })} />
        </label>
      </div>

      <label className="story-field">
        <span>Length</span>
        <select value={shot.seconds} onChange={(e) => set({ seconds: Number(e.target.value) })}>
          {LENGTHS.map((s) => <option key={s} value={s}>{s} seconds</option>)}
        </select>
      </label>

      {restage && (
        <>
          <label className="story-toggle">
            <span>
              Keep the same moves
              <small className="muted">Copies the motion of {anchorName}.</small>
            </span>
            <input type="checkbox" className="switch" checked={shot.keepMoves} onChange={(e) => set({ keepMoves: e.target.checked })} />
          </label>
          <div className="story-field">
            <span>New character photos</span>
            <UploadCard title="Character" icon={<PersonIcon />} optional max={4} files={shot.characters} onChange={(characters) => set({ characters })} onError={setError} />
            <small className="muted">Leave empty to keep the same people.</small>
          </div>
        </>
      )}

      {!ready && <p className="muted small">You can add next to this shot once it has rendered.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="inspector-actions">
        <button type="submit" className="primary" disabled={!ready || sending}>{sending ? "Adding" : "Add shot"}</button>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
      <p className="muted small">Each new shot is a new render, so it uses credits.</p>
    </form>
  );
}
