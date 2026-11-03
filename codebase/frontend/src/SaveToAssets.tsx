import { useEffect, useId, useState } from "react";
import { ApiError, fetchLibrary, saveToLibrary, type LibraryCategory, type LibraryKind, type SaveSource } from "./api";
import { BUILT_IN_CATEGORIES, defaultCategory, goToAssets } from "./useLibrary";

type Props = {
  source: SaveSource;
  kind: LibraryKind;
  /** The Assets item it was saved as, if any. */
  savedId: string | null;
  onSaved: (libraryId: string) => void;
};

/** A link to the item in Assets once saved, otherwise a category choice and a save button. Saving is free. */
export default function SaveToAssets({ source, kind, savedId, onSaved }: Props) {
  const [categories, setCategories] = useState<LibraryCategory[]>(BUILT_IN_CATEGORIES);
  const [category, setCategory] = useState<string | null>(defaultCategory(kind));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectId = useId();

  useEffect(() => {
    if (savedId) return;
    let live = true;
    fetchLibrary()
      .then((lib) => live && lib.categories.length > 0 && setCategories(lib.categories))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [savedId]);

  if (savedId) {
    return (
      <p className="saved-note small">
        <span aria-hidden="true">✓</span> In your Assets.{" "}
        <a
          href={`/?assets=${encodeURIComponent(savedId)}`}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            goToAssets(savedId);
          }}
        >
          Open it
        </a>
      </p>
    );
  }

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved((await saveToLibrary(source, category)).id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save it to Assets. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="save-assets">
      <div className="save-assets-row">
        <label className="sr-only" htmlFor={selectId}>Category</label>
        <select id={selectId} className="text-input" value={category ?? ""} onChange={(e) => setCategory(e.target.value || null)}>
          <option value="">Uncategorized</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button type="button" className="ghost" disabled={busy} onClick={() => void save()}>{busy ? "Saving" : "Save to Assets"}</button>
      </div>
      <p className="muted small">Keeps a copy in Assets, so you can use it on any canvas. Free.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
