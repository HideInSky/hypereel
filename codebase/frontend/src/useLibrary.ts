import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchLibrary, type Library, type LibraryCategory, type LibraryItem, type LibraryKind } from "./api";

const POLL_MS = 3000;

export const KIND_LABEL: Record<LibraryKind, string> = { image: "Image", character: "Character", sheet: "Character sheet", video: "Video" };
/** Plural, for filters. */
export const KIND_PLURAL: Record<LibraryKind, string> = { image: "Images", character: "Characters", sheet: "Sheets", video: "Videos" };

/** Built-in categories, used until the server's list arrives. */
export const BUILT_IN_CATEGORIES: LibraryCategory[] = [
  { id: "characters", name: "Characters", builtIn: true },
  { id: "places", name: "Places", builtIn: true },
  { id: "props", name: "Props", builtIn: true },
];

/** Where a new item goes unless the person picks otherwise. */
export const defaultCategory = (kind: LibraryKind): string | null => (kind === "character" || kind === "sheet" ? "characters" : null);

export const itemWorking = (item: LibraryItem) => item.status === "queued" || item.status === "running";
/** Can go on a board or into an upload slot. */
export const pictureKind = (item: LibraryItem) => item.kind !== "video";
export const usable = (item: LibraryItem) => item.status === "succeeded" && item.images.length > 0;

export type View = { type: "all" } | { type: "favorites" } | { type: "recent" } | { type: "category"; id: string } | { type: "uncategorized" };
export type Sort = "newest" | "used" | "name" | "custom";

export const sameView = (a: View, b: View) => a.type === b.type && (a.type !== "category" || (b.type === "category" && a.id === b.id));

/** Items in a view, before the kind filter and search. */
export function inView(items: LibraryItem[], view: View, categories: LibraryCategory[]): LibraryItem[] {
  switch (view.type) {
    case "all":
      return items;
    case "favorites":
      return items.filter((i) => i.favorite);
    case "recent":
      return items.filter((i) => i.usedAt);
    case "category":
      return items.filter((i) => i.category === view.id);
    case "uncategorized": {
      const known = new Set(categories.map((c) => c.id));
      return items.filter((i) => !i.category || !known.has(i.category));
    }
  }
}

const time = (iso: string | null) => (iso ? Date.parse(iso) : 0);
const newestFirst = (a: LibraryItem, b: LibraryItem) => time(b.createdAt) - time(a.createdAt);
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function sortItems(items: LibraryItem[], sort: Sort): LibraryItem[] {
  const list = [...items];
  switch (sort) {
    case "newest":
      return list.sort(newestFirst);
    case "used":
      return list.sort((a, b) => time(b.usedAt) - time(a.usedAt) || newestFirst(a, b));
    case "name":
      return list.sort((a, b) => byName.compare(a.name, b.name) || newestFirst(a, b));
    case "custom":
      return list.sort((a, b) => {
        if (a.position !== null && b.position !== null) return a.position - b.position || newestFirst(a, b);
        if (a.position !== null) return -1;
        if (b.position !== null) return 1;
        return newestFirst(a, b);
      });
  }
}

export function matches(item: LibraryItem, kind: LibraryKind | "all", query: string): boolean {
  if (kind !== "all" && item.kind !== kind) return false;
  const q = query.trim().toLowerCase();
  return !q || item.name.toLowerCase().includes(q);
}

/** Open Assets (optionally on one item) without a page load. App listens for popstate. */
export function goToAssets(itemId?: string) {
  window.history.pushState(null, "", itemId ? `/?assets=${encodeURIComponent(itemId)}` : "/?assets");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Download the pictures of these items as Files, for an upload slot. */
export async function itemFiles(items: LibraryItem[], limit: number): Promise<File[]> {
  const wanted = items.flatMap((item) => item.images.map((url, i) => ({ url, name: `${item.name}${item.images.length > 1 ? ` ${i + 1}` : ""}` }))).slice(0, limit);
  return Promise.all(
    wanted.map(async ({ url, name }) => {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`Couldn't load ${name}.`);
      const blob = await res.blob();
      const ext = url.split("?")[0]!.match(/\.(png|jpe?g|webp)$/i)?.[1]?.toLowerCase();
      const type = blob.type.startsWith("image/") ? blob.type : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      const suffix = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
      return new File([blob], `${name.replace(/[^\w\- ]+/g, "").trim() || "asset"}.${suffix}`, { type });
    }),
  );
}

/**
 * The viewer's Assets. Polls every 3 s while anything is being made. Local changes bump a
 * version, and a poll that started before a change is dropped, so it can't undo the change.
 */
export function useLibrary(enabled = true) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);

  const reload = useCallback(async () => {
    const at = version.current;
    try {
      const next = await fetchLibrary();
      if (version.current !== at) return;
      setLibrary(next);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't load your Assets. Check your connection.");
      setLibrary((cur) => cur ?? { items: [], categories: BUILT_IN_CATEGORIES });
    }
  }, []);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  const busy = !!library?.items.some(itemWorking);
  useEffect(() => {
    if (!busy || !enabled) return;
    const t = window.setInterval(() => void reload(), POLL_MS);
    return () => window.clearInterval(t);
  }, [busy, enabled, reload]);

  const change = useCallback((fn: (lib: Library) => Library) => {
    version.current += 1;
    setLibrary((cur) => (cur ? fn(cur) : cur));
  }, []);

  /** Add a new item at the front, or replace one by id. */
  const putItem = useCallback(
    (item: LibraryItem) => change((lib) => ({ ...lib, items: lib.items.some((i) => i.id === item.id) ? lib.items.map((i) => (i.id === item.id ? item : i)) : [item, ...lib.items] })),
    [change],
  );
  const dropItem = useCallback((id: string) => change((lib) => ({ ...lib, items: lib.items.filter((i) => i.id !== id) })), [change]);
  const putCategory = useCallback(
    (cat: LibraryCategory) => change((lib) => ({ ...lib, categories: lib.categories.some((c) => c.id === cat.id) ? lib.categories.map((c) => (c.id === cat.id ? cat : c)) : [...lib.categories, cat] })),
    [change],
  );
  const dropCategory = useCallback(
    (id: string) => change((lib) => ({ categories: lib.categories.filter((c) => c.id !== id), items: lib.items.map((i) => (i.category === id ? { ...i, category: null } : i)) })),
    [change],
  );
  /** Give exactly these items positions by index, as the server does. */
  const setOrder = useCallback(
    (ids: string[]) => {
      const at = new Map(ids.map((id, i) => [id, i]));
      change((lib) => ({ ...lib, items: lib.items.map((i) => (at.has(i.id) ? { ...i, position: at.get(i.id)! } : i)) }));
    },
    [change],
  );

  return { library, error, reload, putItem, dropItem, putCategory, dropCategory, setOrder };
}
