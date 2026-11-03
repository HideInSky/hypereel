import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ApiError, orderLibrary, updateLibraryItem, type LibraryItem, type LibraryKind } from "./api";
import LibraryThumb from "./LibraryThumb";
import { AddForm, CategoryManager, ItemDetails } from "./LibraryPanels";
import { BoxIcon, ClockIcon, GridIcon, GripIcon, PersonIcon, PinIcon, SearchIcon, StarIcon, TagIcon } from "./Icons";
import { KIND_LABEL, KIND_PLURAL, inView, matches, sameView, sortItems, useLibrary, type Sort, type View } from "./useLibrary";

type Panel = { type: "item"; id: string } | { type: "add"; how: "upload" | "generate"; preset: string[]; key: number } | null;

type Props = {
  /** Item to open, e.g. from /?assets=<id>. */
  focusId: string | null;
  toast: (message: string) => void;
  onCanvas: () => void;
};

const SORTS: { id: Sort; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "used", label: "Recently used" },
  { id: "name", label: "Name" },
  { id: "custom", label: "Custom order" },
];
const KINDS: (LibraryKind | "all")[] = ["all", "image", "character", "sheet", "video"];
const CATEGORY_ICON: Record<string, ReactNode> = { characters: <PersonIcon />, places: <PinIcon />, props: <BoxIcon /> };
const DRAG_SLOP = 5;

const message = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** Everything the viewer kept: views and categories on the left, a grid, and the selected item's details. */
export default function Assets({ focusId, toast, onCanvas }: Props) {
  const { library, error, reload, putItem, dropItem, putCategory, dropCategory, setOrder } = useLibrary();
  const [view, setView] = useState<View>({ type: "all" });
  const [kind, setKind] = useState<LibraryKind | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [panel, setPanel] = useState<Panel>(null);
  const [managing, setManaging] = useState(false);
  const [drag, setDrag] = useState<{ id: string; order: string[] } | null>(null);
  const [announce, setAnnounce] = useState("");
  const press = useRef<{ id: string; x: number; y: number; started: boolean; order: string[] } | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const focusPanel = useRef(false);

  const items = useMemo(() => library?.items ?? [], [library]);
  const categories = library?.categories ?? [];
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // Open the item named in the URL once it has loaded, with filters cleared so it shows.
  const loaded = !!library;
  useEffect(() => {
    if (!focusId || !loaded) return;
    if (!byId.has(focusId)) return;
    setView({ type: "all" });
    setKind("all");
    setQuery("");
    setPanel({ type: "item", id: focusId });
    // Only when a new item is asked for.
  }, [focusId, loaded]);

  const shown = useMemo(() => sortItems(inView(items, view, categories).filter((i) => matches(i, kind, query)), sort), [items, view, categories, kind, query, sort]);
  const ordered = drag ? drag.order.map((id) => byId.get(id)).filter((i): i is LibraryItem => !!i) : shown;
  const custom = sort === "custom";

  useEffect(() => {
    if (!focusPanel.current || !panel) return;
    focusPanel.current = false;
    const el = panelRef.current;
    (el?.querySelector<HTMLElement>("[data-autofocus]") ?? el)?.focus();
  }, [panel]);

  const openPanel = (next: Panel, fromKeyboard: boolean) => {
    focusPanel.current = fromKeyboard;
    setPanel(next);
  };

  const closePanel = () => {
    const id = panel?.type === "item" ? panel.id : null;
    setPanel(null);
    if (id) window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-lib-id="${CSS.escape(id)}"] .lib-tile-main`)?.focus());
  };

  const chooseView = (next: View) => {
    setView(next);
    if (next.type === "recent" && sort === "newest") setSort("used");
  };

  const counts = (v: View) => inView(items, v, categories).length;
  const viewLabel = (v: View) =>
    v.type === "all" ? "All" : v.type === "favorites" ? "Favorites" : v.type === "recent" ? "Recently used" : v.type === "uncategorized" ? "Uncategorized" : (categories.find((c) => c.id === v.id)?.name ?? "Category");

  // ---------- Reordering ----------

  const commitOrder = useCallback(
    (ids: string[]) => {
      setOrder(ids);
      orderLibrary(ids).catch((err) => {
        toast(message(err, "Couldn't save the new order. Try again."));
        void reload();
      });
    },
    [setOrder, reload, toast],
  );

  const move = (id: string, delta: -1 | 1) => {
    const ids = shown.map((i) => i.id);
    const at = ids.indexOf(id);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= ids.length) return;
    ids.splice(at, 1);
    ids.splice(to, 0, id);
    commitOrder(ids);
    setAnnounce(`${byId.get(id)?.name ?? "Item"} moved to position ${to + 1} of ${ids.length}.`);
    // Keep focus on the same button once the tile has moved.
    const dir = delta < 0 ? "earlier" : "later";
    window.requestAnimationFrame(() => {
      const tile = document.querySelector<HTMLElement>(`[data-lib-id="${CSS.escape(id)}"]`);
      const btn = tile?.querySelector<HTMLButtonElement>(`.lib-move--${dir}`);
      (btn && !btn.disabled ? btn : tile?.querySelector<HTMLElement>(".lib-move:not(:disabled)"))?.focus();
    });
  };

  const onGripDown = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { id, x: e.clientX, y: e.clientY, started: false, order: shown.map((i) => i.id) };
  };
  const onGripMove = (e: ReactPointerEvent<HTMLElement>) => {
    const p = press.current;
    if (!p) return;
    if (!p.started) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_SLOP) return;
      p.started = true;
    }
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-lib-id]");
    const overId = over?.dataset.libId;
    if (overId && overId !== p.id) {
      const order = p.order.filter((x) => x !== p.id);
      const at = order.indexOf(overId);
      const after = p.order.indexOf(overId) > p.order.indexOf(p.id);
      if (at >= 0) {
        order.splice(after ? at + 1 : at, 0, p.id);
        p.order = order;
      }
    }
    setDrag({ id: p.id, order: p.order });
    // Scroll the grid when dragging near its top or bottom edge.
    const scroller = document.querySelector<HTMLElement>(".lib-scroll");
    if (scroller && scroller.scrollHeight > scroller.clientHeight) {
      const r = scroller.getBoundingClientRect();
      if (e.clientY < r.top + 48) scroller.scrollBy(0, -12);
      else if (e.clientY > r.bottom - 48) scroller.scrollBy(0, 12);
    } else if (e.clientY > window.innerHeight - 48) window.scrollBy(0, 12);
    else if (e.clientY < 48) window.scrollBy(0, -12);
  };
  const onGripUp = () => {
    const p = press.current;
    press.current = null;
    setDrag(null);
    if (!p?.started) return;
    const before = shown.map((i) => i.id).join(",");
    if (p.order.join(",") !== before) {
      commitOrder(p.order);
      setAnnounce(`${byId.get(p.id)?.name ?? "Item"} moved to position ${p.order.indexOf(p.id) + 1} of ${p.order.length}.`);
    }
  };
  const onGripCancel = () => {
    press.current = null;
    setDrag(null);
  };

  const toggleFavorite = async (item: LibraryItem) => {
    putItem({ ...item, favorite: !item.favorite });
    try {
      putItem(await updateLibraryItem(item.id, { favorite: !item.favorite }));
    } catch (err) {
      putItem(item);
      toast(message(err, "Couldn't change favorites. Try again."));
    }
  };

  // ---------- Panel ----------

  const selectedId = panel?.type === "item" ? panel.id : null;
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const addCategory = view.type === "category" ? view.id : null;

  const made = (item: LibraryItem) => {
    putItem(item);
    setPanel({ type: "item", id: item.id });
    // Make sure the new item is visible.
    if (!matches(item, kind, query) || !inView([item], view, categories).length) {
      setView({ type: "all" });
      setKind("all");
      setQuery("");
    }
  };

  let panelBody = null;
  if (library && panel?.type === "add") {
    panelBody = (
      <AddForm
        key={panel.key}
        how={panel.how}
        library={library}
        categories={categories}
        category={addCategory}
        preset={panel.preset}
        onCategory={putCategory}
        onDone={(item) => {
          made(item);
          toast(item.status === "succeeded" ? `${item.name} added` : `Making ${item.name}`);
        }}
        onCancel={closePanel}
      />
    );
  } else if (library && selected) {
    panelBody = (
      <ItemDetails
        key={selected.id}
        item={selected}
        library={library}
        onChanged={putItem}
        onMade={(item) => {
          made(item);
          toast(`Making ${item.name}`);
        }}
        onDeleted={(id) => {
          dropItem(id);
          setPanel(null);
          toast("Deleted");
        }}
        onCategory={putCategory}
        onOpen={(id) => {
          if (!shown.some((i) => i.id === id)) {
            setView({ type: "all" });
            setKind("all");
            setQuery("");
          }
          setPanel({ type: "item", id });
          window.requestAnimationFrame(() => document.querySelector(`[data-lib-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" }));
        }}
        onUseAsReference={(id) => setPanel({ type: "add", how: "generate", preset: [id], key: Date.now() })}
      />
    );
  }

  const views: { view: View; label: string; icon: ReactNode }[] = [
    { view: { type: "all" }, label: "All", icon: <GridIcon /> },
    { view: { type: "favorites" }, label: "Favorites", icon: <StarIcon /> },
    { view: { type: "recent" }, label: "Recently used", icon: <ClockIcon /> },
  ];
  const catViews = [
    ...categories.map((c) => ({ view: { type: "category", id: c.id } as View, label: c.name, icon: CATEGORY_ICON[c.id] ?? <TagIcon /> })),
    { view: { type: "uncategorized" } as View, label: "Uncategorized", icon: <TagIcon /> },
  ];
  const railButton = ({ view: v, label, icon }: { view: View; label: string; icon: ReactNode }) => {
    const on = sameView(v, view);
    return (
      <li key={v.type === "category" ? `c:${v.id}` : v.type}>
        <button type="button" className={`lib-view${on ? " lib-view--on" : ""}`} aria-current={on ? "true" : undefined} onClick={() => chooseView(v)}>
          <span className="lib-view-icon">{icon}</span>
          <span className="lib-view-label">{label}</span>
          <span className="lib-view-count">{library ? counts(v) : ""}</span>
        </button>
      </li>
    );
  };

  const filtered = kind !== "all" || query.trim() !== "";
  const clearFilters = () => {
    setKind("all");
    setQuery("");
  };

  let body: ReactNode;
  if (!library) {
    body = <p className="muted small lib-empty">Loading your Assets</p>;
  } else if (!items.length) {
    body = (
      <div className="lib-empty lib-empty--first">
        <div className="lib-empty-prints" aria-hidden="true"><span /><span /><span /></div>
        <strong>Keep the pictures and clips you want to reuse</strong>
        <p className="muted small">Save images, characters and videos from a canvas or a clip page, or add your own here. Then sort them into characters, places and props, and pick them from any canvas or upload slot.</p>
        <div className="inspector-actions">
          <button type="button" className="primary" onClick={(e) => openPanel({ type: "add", how: "upload", preset: [], key: Date.now() }, e.detail === 0)}>Upload</button>
          <button type="button" className="ghost" onClick={(e) => openPanel({ type: "add", how: "generate", preset: [], key: Date.now() }, e.detail === 0)}>Generate</button>
          <button type="button" className="ghost" onClick={onCanvas}>Open Canvas</button>
        </div>
      </div>
    );
  } else if (!shown.length) {
    body = (
      <div className="lib-empty">
        {filtered ? (
          <>
            <strong>Nothing matches</strong>
            <p className="muted small">No {kind === "all" ? "items" : KIND_PLURAL[kind].toLowerCase()}{query.trim() ? ` named “${query.trim()}”` : ""} in {viewLabel(view)}.</p>
            <button type="button" className="ghost" onClick={clearFilters}>Clear filters</button>
          </>
        ) : view.type === "favorites" ? (
          <>
            <strong>No favorites yet</strong>
            <p className="muted small">Tap the star on any item to keep it here.</p>
          </>
        ) : view.type === "recent" ? (
          <>
            <strong>Nothing used yet</strong>
            <p className="muted small">Items you place on a canvas or use as a reference show up here.</p>
          </>
        ) : view.type === "uncategorized" ? (
          <>
            <strong>Everything has a category</strong>
            <p className="muted small">New items without one land here.</p>
          </>
        ) : (
          <>
            <strong>Nothing in {viewLabel(view)} yet</strong>
            <p className="muted small">Open an item and choose {viewLabel(view)} as its category, or upload straight into it.</p>
            <button type="button" className="ghost" onClick={(e) => openPanel({ type: "add", how: "upload", preset: [], key: Date.now() }, e.detail === 0)}>Upload to {viewLabel(view)}</button>
          </>
        )}
      </div>
    );
  } else {
    body = (
      <ul className={`lib-grid${drag ? " lib-grid--dragging" : ""}`} aria-label={`${viewLabel(view)}, ${shown.length} item${shown.length === 1 ? "" : "s"}`}>
        {ordered.map((item, i) => {
          const on = item.id === selectedId;
          return (
            <li key={item.id} data-lib-id={item.id} className={`lib-tile${on ? " lib-tile--on" : ""}${drag?.id === item.id ? " lib-tile--lifted" : ""}`}>
              <button
                type="button"
                className="lib-tile-main"
                aria-pressed={on}
                aria-label={`${item.name}, ${KIND_LABEL[item.kind]}${item.status === "failed" ? ", didn't work" : item.status !== "succeeded" ? ", being made" : ""}`}
                onClick={(e) => (on ? closePanel() : openPanel({ type: "item", id: item.id }, e.detail === 0))}
              >
                <LibraryThumb item={item} playOnHover />
                <span className="lib-foot">
                  <span className={`cc-kind cc-kind--${item.kind}`}>{KIND_LABEL[item.kind]}</span>
                  <span className="cc-name">{item.name}</span>
                </span>
              </button>
              <button
                type="button"
                className={`lib-star${item.favorite ? " lib-star--on" : ""}`}
                aria-pressed={item.favorite}
                aria-label={`Favorite ${item.name}`}
                onClick={() => void toggleFavorite(item)}
              >
                <StarIcon filled={item.favorite} />
              </button>
              {custom && (
                <span className="lib-order">
                  <span
                    className="lib-grip"
                    aria-hidden="true"
                    title="Drag to reorder"
                    onPointerDown={(e) => onGripDown(e, item.id)}
                    onPointerMove={onGripMove}
                    onPointerUp={onGripUp}
                    onPointerCancel={onGripCancel}
                    onLostPointerCapture={() => press.current && onGripUp()}
                  >
                    <GripIcon />
                  </span>
                  <button type="button" className="lib-move lib-move--earlier" aria-label={`Move ${item.name} earlier`} disabled={i === 0 || !!drag} onClick={() => move(item.id, -1)}>‹</button>
                  <button type="button" className="lib-move lib-move--later" aria-label={`Move ${item.name} later`} disabled={i === ordered.length - 1 || !!drag} onClick={() => move(item.id, 1)}>›</button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className={`lib${panelBody ? " lib--panel" : ""}`}>
      <nav className="lib-rail" aria-label="Asset views">
        <ul className="lib-views">{views.map(railButton)}</ul>
        <div className="lib-rail-head">
          <span>Categories</span>
          <button type="button" className="lib-manage" onClick={() => setManaging(true)} disabled={!library}>Edit</button>
        </div>
        <ul className="lib-views">{catViews.map(railButton)}</ul>
      </nav>

      <section className="lib-main" aria-label="Assets">
        <div className="lib-head">
          <div className="lib-heading">
            <h2>{viewLabel(view)}</h2>
            <p className="muted small">{view.type === "all" ? "Everything you kept. Save from a canvas or a clip, upload, or generate." : `${library ? counts(view) : 0} in your Assets`}</p>
          </div>
          <div className="lib-add">
            <button type="button" className="ghost" onClick={(e) => openPanel({ type: "add", how: "upload", preset: [], key: Date.now() }, e.detail === 0)}>Upload</button>
            <button type="button" className="primary" onClick={(e) => openPanel({ type: "add", how: "generate", preset: [], key: Date.now() }, e.detail === 0)}>Generate</button>
          </div>
        </div>

        <div className="lib-tools">
          <label className="search lib-search">
            <SearchIcon />
            <input type="search" placeholder="Search by name" aria-label="Search by name" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="lib-kinds" role="group" aria-label="Kind">
            {KINDS.map((k) => (
              <button key={k} type="button" className={`chip${kind === k ? " chip--on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === "all" ? "All kinds" : KIND_PLURAL[k]}
              </button>
            ))}
          </div>
          <label className="lib-select lib-sort">
            <span>Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        </div>
        {custom && shown.length > 1 && <p className="muted small lib-hint">Drag the handle on a tile, or use its arrows, to change the order of what's shown here.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="lib-scroll">{body}</div>
        <p className="sr-only" aria-live="polite">{announce}</p>
      </section>

      {panelBody && (
        <aside
          ref={panelRef}
          className="lib-panel"
          aria-label={panel?.type === "add" ? "Add to Assets" : "Details"}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !(e.target as HTMLElement).closest("dialog")) {
              e.stopPropagation();
              closePanel();
            }
          }}
        >
          <button type="button" className="canvas-inspector-close" aria-label="Close" onClick={closePanel}>×</button>
          {panelBody}
        </aside>
      )}

      {managing && library && (
        <CategoryManager
          library={library}
          onCategory={putCategory}
          onDeleted={(id) => {
            dropCategory(id);
            if (view.type === "category" && view.id === id) setView({ type: "uncategorized" });
          }}
          onClose={() => setManaging(false)}
        />
      )}
    </div>
  );
}
