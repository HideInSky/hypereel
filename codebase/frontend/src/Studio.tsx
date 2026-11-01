import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ApiError, fetchCommunityRecipes, previewRecipe, saveCustomEffect, type Effect, type ImageCounts, type Recipe } from "./api";

export type Draft = { recipe: Recipe; remixOf: string | null };

export const BLANK_RECIPE: Recipe = {
  name: "",
  description: "",
  seconds: 6,
  look: "photoreal",
  camera: "Handheld shot of the character {place}.",
  beats: [
    { from: 0, to: 2, action: "" },
    { from: 2, to: 6, action: "" },
  ],
  product: "",
  sound: "",
};

const LENGTHS = [5, 6, 8];
const MAX_BEATS = 6;

type Props = {
  draft: Draft;
  setDraft: (next: Draft) => void;
  counts: ImageCounts;
  onSaved: (effect: Effect) => void;
};

/** Write an effect as timed beats, see the exact prompt it makes, and save it as a shareable link. */
export default function Studio({ draft, setDraft, counts, onSaved }: Props) {
  const { recipe, remixOf } = draft;
  const [templates, setTemplates] = useState<{ id: string; recipe: Recipe }[]>([]);
  const [prompt, setPrompt] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const importer = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchCommunityRecipes().then(setTemplates).catch(() => {});
  }, []);

  // Asks the server, so this is the real prompt and the same validation as saving.
  useEffect(() => {
    let stale = false;
    const timer = window.setTimeout(() => {
      previewRecipe({ ...recipe, name: recipe.name || "Draft" }, counts)
        .then((r) => { if (!stale) { setPrompt(r.prompt); setProblem(null); } })
        .catch((err) => { if (!stale) setProblem(err instanceof ApiError ? err.message : "Can't check this recipe right now."); });
    }, 350);
    return () => { stale = true; window.clearTimeout(timer); };
  }, [recipe, counts]);

  const set = (patch: Partial<Recipe>) => setDraft({ recipe: { ...recipe, ...patch }, remixOf });
  const setBeat = (i: number, patch: Partial<Recipe["beats"][number]>) =>
    set({ beats: recipe.beats.map((b, n) => (n === i ? { ...b, ...patch } : b)) });
  const addBeat = () => {
    const last = recipe.beats.at(-1);
    const from = Math.min(last?.to ?? 0, recipe.seconds - 1);
    set({ beats: [...recipe.beats, { from, to: recipe.seconds, action: "" }] });
  };

  const useTemplate = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    e.target.value = "";
    if (value === "blank") setDraft({ recipe: BLANK_RECIPE, remixOf: null });
    const found = templates.find((t) => t.id === value);
    if (found) setDraft({ recipe: found.recipe, remixOf: null });
  };

  const download = () => {
    const blob = new Blob([JSON.stringify({ format: "hypereel-effect/1", ...recipe }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${recipe.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "effect"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Partial<Recipe>;
      if (!Array.isArray(parsed.beats)) throw new Error("no beats");
      setDraft({ recipe: { ...BLANK_RECIPE, ...parsed }, remixOf: null });
    } catch {
      setProblem("That file isn't a hypereel effect recipe.");
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      onSaved(await saveCustomEffect(recipe, remixOf));
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="studio">
      <div className="studio-form">
        <div className="studio-head">
          <div>
            <h2>Effect Studio</h2>
            <p className="muted small">{remixOf ? "Remixing an effect. Your version gets its own link." : "Write your own effect as timed beats. Saving costs nothing; only rendering uses credits."}</p>
          </div>
          <select className="studio-start" aria-label="Start from" defaultValue="" onChange={useTemplate}>
            <option value="" disabled>Start from</option>
            <option value="blank">Blank</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.recipe.name}</option>)}
          </select>
        </div>

        <div className="studio-row">
          <label className="studio-field studio-grow">
            <span>Name</span>
            <input type="text" maxLength={40} value={recipe.name} placeholder="Gravity Flip" onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="studio-field">
            <span>Length</span>
            <select value={recipe.seconds} onChange={(e) => set({ seconds: Number(e.target.value) })}>
              {LENGTHS.map((s) => <option key={s} value={s}>{s} seconds</option>)}
            </select>
          </label>
          <label className="studio-field">
            <span>Look</span>
            <select value={recipe.look} onChange={(e) => set({ look: e.target.value as Recipe["look"] })}>
              <option value="photoreal">Photoreal</option>
              <option value="stylized">Stylized</option>
            </select>
          </label>
        </div>

        <label className="studio-field">
          <span>Camera</span>
          <input type="text" maxLength={300} value={recipe.camera} placeholder="Slow push-in on the character {place}." onChange={(e) => set({ camera: e.target.value })} />
          <small className="muted">{"{place}"} becomes the location photo, or a setting that suits the photo.</small>
        </label>

        <fieldset className="studio-beats">
          <legend>Beats</legend>
          {recipe.beats.map((b, i) => (
            <div className="studio-beat" key={i}>
              <div className="studio-times">
                <input type="number" aria-label={`Beat ${i + 1} start, seconds`} min={0} max={recipe.seconds} value={b.from} onChange={(e) => setBeat(i, { from: Number(e.target.value) })} />
                <span aria-hidden="true">to</span>
                <input type="number" aria-label={`Beat ${i + 1} end, seconds`} min={0} max={recipe.seconds} value={b.to} onChange={(e) => setBeat(i, { to: Number(e.target.value) })} />
              </div>
              <textarea rows={2} maxLength={800} aria-label={`Beat ${i + 1} action`} value={b.action} placeholder="What happens in this beat?" onChange={(e) => setBeat(i, { action: e.target.value })} />
              <button type="button" className="studio-remove" aria-label={`Remove beat ${i + 1}`} disabled={recipe.beats.length === 1} onClick={() => set({ beats: recipe.beats.filter((_, n) => n !== i) })}>×</button>
            </div>
          ))}
          <button type="button" className="ghost" disabled={recipe.beats.length >= MAX_BEATS} onClick={addBeat}>Add a beat</button>
        </fieldset>

        <label className="studio-field">
          <span>Sound</span>
          <input type="text" maxLength={300} value={recipe.sound} placeholder="H3 renders audio too: footsteps, wind, a rising synth" onChange={(e) => set({ sound: e.target.value })} />
        </label>
        <label className="studio-field">
          <span>If product photos are added</span>
          <input type="text" maxLength={300} value={recipe.product} placeholder="The product items float beside them." onChange={(e) => set({ product: e.target.value })} />
        </label>
        <label className="studio-field">
          <span>Description</span>
          <input type="text" maxLength={140} value={recipe.description} placeholder="One line about what it does" onChange={(e) => set({ description: e.target.value })} />
        </label>
      </div>

      <div className="studio-side">
        <div className="studio-prompt">
          <h3>What MiniMax H3 will read</h3>
          <p>{prompt || "Your prompt appears here."}</p>
          <p className="muted small">Based on {Math.max(1, counts.characters)} character, {counts.locations} location and {counts.products} product photos.</p>
        </div>
        {problem && <p className="form-error" role="alert">{problem}</p>}
        <button type="button" className="primary" disabled={saving || !recipe.name.trim() || !!problem} onClick={() => void save()}>
          {saving ? "Saving" : "Save and use this effect"}
        </button>
        <div className="studio-files">
          <button type="button" className="ghost" onClick={download}>Download JSON</button>
          <button type="button" className="ghost" onClick={() => importer.current?.click()}>Import JSON</button>
          <input ref={importer} type="file" accept="application/json,.json" hidden onChange={(e) => void importFile(e)} />
        </div>
        <p className="muted small">The JSON runs in ComfyUI too: drop it into <code>comfyui-hypereel/recipes/community</code>, or open a pull request to share it with everyone.</p>
      </div>
    </div>
  );
}
