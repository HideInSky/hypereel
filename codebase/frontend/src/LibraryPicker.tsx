import { useMemo, useState } from "react";
import { ApiError, type LibraryItem, type LibraryKind } from "./api";
import Dialog from "./Dialog";
import LibraryThumb from "./LibraryThumb";
import { CheckIcon } from "./Icons";
import { KIND_LABEL, KIND_PLURAL, goToAssets, inView, matches, sameView, sortItems, usable, useLibrary, type View } from "./useLibrary";

type Props = {
  title: string;
  /** Most items that can be picked at once. */
  max: number;
  /** Kinds that are shown and can be picked. */
  kinds: LibraryKind[];
  /** The confirm button, given how many are picked. */
  confirmLabel: (count: number) => string;
  /** One line under the grid, e.g. what happens next. */
  note?: string;
  /** Use the picked items. Throw (ideally an ApiError) to keep the dialog open with a message. */
  onPick: (items: LibraryItem[]) => Promise<void>;
  onClose: () => void;
};

/** Choose items from Assets: by favorites, recently used, category or all, filtered by kind. */
export default function LibraryPicker({ title, max, kinds, confirmLabel, note, onPick, onClose }: Props) {
  const { library, error: loadError } = useLibrary();
  const [view, setView] = useState<View | null>(null);
  const [kind, setKind] = useState<LibraryKind | "all">("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => (library?.items ?? []).filter((i) => kinds.includes(i.kind)), [library, kinds]);
  const categories = library?.categories ?? [];

  const tabs: { view: View; label: string }[] = [
    { view: { type: "favorites" }, label: "Favorites" },
    { view: { type: "recent" }, label: "Recently used" },
    ...categories.map((c) => ({ view: { type: "category", id: c.id } as View, label: c.name })),
    { view: { type: "all" }, label: "All" },
  ];
  // Until the person picks a tab: favorites if they have any, then recently used, then everything.
  const current: View = view ?? (items.some((i) => i.favorite) ? { type: "favorites" } : items.some((i) => i.usedAt) ? { type: "recent" } : { type: "all" });
  const shown = sortItems(
    inView(items, current, categories).filter((i) => matches(i, kind, "")),
    current.type === "recent" ? "used" : "custom",
  );

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= max ? p : [...p, id]));

  const confirm = async () => {
    const chosen = picked.map((id) => items.find((i) => i.id === id)).filter((i): i is LibraryItem => !!i);
    if (!chosen.length) return;
    setBusy(true);
    setError(null);
    try {
      await onPick(chosen);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Couldn't use those. Try again.");
      setBusy(false);
    }
  };

  return (
    <Dialog title={title} onClose={onClose} className="dialog--picker">
      <div className="picker-bar">
        <div className="picker-tabs" role="group" aria-label="Show">
          {tabs.map((t) => {
            const on = sameView(t.view, current);
            return (
              <button key={t.label + (t.view.type === "category" ? t.view.id : "")} type="button" className={`chip${on ? " chip--on" : ""}`} aria-pressed={on} onClick={() => setView(t.view)}>
                {t.label}
              </button>
            );
          })}
        </div>
        {kinds.length > 1 && (
          <label className="lib-select">
            <span className="sr-only">Kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as LibraryKind | "all")}>
              <option value="all">All kinds</option>
              {kinds.map((k) => <option key={k} value={k}>{KIND_PLURAL[k]}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="picker-scroll">
        {!library ? (
          <p className="muted small picker-empty">Loading your Assets</p>
        ) : !items.length ? (
          <div className="picker-empty">
            <strong>Nothing in your Assets yet</strong>
            <p className="muted small">Save an image or character from a canvas, or upload and generate them in Assets.</p>
            <button type="button" className="ghost" onClick={() => goToAssets()}>Open Assets</button>
          </div>
        ) : !shown.length ? (
          <p className="muted small picker-empty">
            {current.type === "favorites" ? "No favorites yet. Star items in Assets to find them here." : current.type === "recent" ? "Nothing used yet. Items you put on a canvas show up here." : "Nothing here yet."}
          </p>
        ) : (
          <ul className="picker-grid">
            {shown.map((item) => {
              const on = picked.includes(item.id);
              const ok = usable(item);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`picker-tile${on ? " picker-tile--on" : ""}`}
                    aria-pressed={on}
                    aria-label={`${item.name}, ${KIND_LABEL[item.kind]}${ok ? "" : ", not ready"}`}
                    disabled={!ok || (!on && picked.length >= max)}
                    onClick={() => toggle(item.id)}
                  >
                    <LibraryThumb item={item} />
                    {on && <span className="tile-check"><CheckIcon /></span>}
                    <span className="picker-tile-name">{item.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="picker-foot">
        {(error ?? loadError) && <p className="form-error" role="alert">{error ?? loadError}</p>}
        <p className="muted small">{picked.length ? `${picked.length} of ${max} picked.` : `Pick up to ${max}.`}{note ? ` ${note}` : ""}</p>
        <div className="inspector-actions">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" disabled={!picked.length || busy} onClick={() => void confirm()}>{busy ? "Adding" : confirmLabel(picked.length)}</button>
        </div>
      </div>
    </Dialog>
  );
}
