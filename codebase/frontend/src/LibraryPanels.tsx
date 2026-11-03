import { useId, useState } from "react";
import {
  ApiError,
  createCategory,
  deleteCategory,
  deleteLibraryItem,
  generateLibraryItem,
  makeLibrarySheet,
  regenerateLibraryItem,
  renameCategory,
  updateLibraryItem,
  uploadLibraryItem,
  type Library,
  type LibraryCategory,
  type LibraryItem,
} from "./api";
import Dialog from "./Dialog";
import LibraryPicker from "./LibraryPicker";
import SheetChanges from "./SheetChanges";
import UploadCard from "./UploadCard";
import { PersonIcon, PinIcon, StarIcon } from "./Icons";
import { KIND_LABEL, defaultCategory, itemWorking, usable } from "./useLibrary";
import { PROMPT_MAX } from "./textLimits";

const message = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const NEW = "__new";
const MAX_REFS = 4;

type CategorySelectProps = {
  categories: LibraryCategory[];
  value: string | null;
  onChange: (id: string | null) => void | Promise<void>;
  onCreated: (cat: LibraryCategory) => void;
  disabled?: boolean;
};

/** A category dropdown whose last option makes a new category on the spot. */
export function CategorySelect({ categories, value, onChange, onCreated, disabled }: CategorySelectProps) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectId = useId();

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const cat = await createCategory(name);
      onCreated(cat);
      await onChange(cat.id);
      setAdding(false);
      setName("");
    } catch (err) {
      setError(message(err, "Couldn't add the category. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="story-field">
      <label htmlFor={selectId}>Category</label>
      <select
        id={selectId}
        className="text-input"
        disabled={disabled}
        value={adding ? NEW : (value ?? "")}
        onChange={(e) => {
          setError(null);
          if (e.target.value === NEW) return setAdding(true);
          setAdding(false);
          void onChange(e.target.value || null);
        }}
      >
        <option value="">Uncategorized</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value={NEW}>New category…</option>
      </select>
      {adding && (
        <div className="inline-add">
          <input
            className="text-input"
            type="text"
            aria-label="New category name"
            maxLength={40}
            placeholder="Vehicles"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
              if (e.key === "Escape") {
                e.stopPropagation();
                setAdding(false);
              }
            }}
          />
          <button type="button" className="ghost" disabled={busy || !name.trim()} onClick={() => void add()}>{busy ? "Adding" : "Add"}</button>
          <button type="button" className="ghost" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

type DetailsProps = {
  item: LibraryItem;
  library: Library;
  onChanged: (item: LibraryItem) => void;
  /** A new item made from this one (regenerate, a sheet, a new outfit or style). */
  onMade: (item: LibraryItem) => void;
  onDeleted: (id: string) => void;
  onCategory: (cat: LibraryCategory) => void;
  onOpen: (id: string) => void;
  onUseAsReference: (id: string) => void;
};

/** One item: preview, name, category, favorite, what made it, and what can be made from it. */
export function ItemDetails({ item, library, onChanged, onMade, onDeleted, onCategory, onOpen, onUseAsReference }: DetailsProps) {
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const done = item.status === "succeeded";
  const isPicture = item.kind !== "video";

  const run = async (what: string, fn: () => Promise<void>, fallback: string) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(message(err, fallback));
    } finally {
      setBusy(null);
    }
  };

  const update = (changes: Parameters<typeof updateLibraryItem>[1], fallback: string) =>
    run("update", async () => onChanged(await updateLibraryItem(item.id, changes)), fallback);

  const rename = (next: string) => {
    setName(null);
    const clean = next.trim();
    if (!clean || clean === item.name) return;
    void update({ name: clean.slice(0, 60) }, "Couldn't rename it. Try again.");
  };

  const sources = item.sources.map((id) => ({ id, found: library.items.find((i) => i.id === id) }));
  const downloadName = (i: number) => `${item.name.replace(/[^\w\- ]+/g, "").trim() || "asset"}${item.images.length > 1 ? `-${i + 1}` : ""}`;

  return (
    <div className="inspector-body">
      <span className={`kind-tag kind-tag--asset-${item.kind}`}>{KIND_LABEL[item.kind]}</span>
      <input
        className="lib-name"
        aria-label="Name"
        data-autofocus
        maxLength={60}
        value={name ?? item.name}
        onChange={(e) => setName(e.target.value)}
        onBlur={(e) => rename(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape" && name !== null) {
            e.stopPropagation();
            setName(null);
          }
        }}
      />

      {item.kind === "video" && item.videoUrl ? (
        <video className="inspector-video" src={item.videoUrl} poster={item.images[0]} controls playsInline preload="metadata" />
      ) : item.images.length > 0 ? (
        <div className={`asset-images${item.images.length === 1 ? " asset-images--one" : ""}${item.kind === "sheet" ? " asset-images--sheet" : ""}`}>
          {item.images.map((src, i) => <img key={src} src={src} alt={`${item.name}, picture ${i + 1}`} />)}
        </div>
      ) : null}
      {itemWorking(item) && <p className="muted small">Making it now. It shows up here when it's ready; you can keep working.</p>}
      {item.status === "failed" && <p className="form-error">{item.error ?? "This one didn't work."} {item.canRegenerate ? "Try Regenerate, or delete it." : "Delete it and try again."}</p>}

      <div className="lib-fav-row">
        <button
          type="button"
          className={`ghost lib-fav${item.favorite ? " lib-fav--on" : ""}`}
          aria-pressed={item.favorite}
          disabled={busy === "update"}
          onClick={() => void update({ favorite: !item.favorite }, "Couldn't change favorites. Try again.")}
        >
          <StarIcon filled={item.favorite} /> {item.favorite ? "In favorites" : "Add to favorites"}
        </button>
      </div>

      <CategorySelect
        categories={library.categories}
        value={item.category}
        onCreated={onCategory}
        onChange={(category) => update({ category }, "Couldn't change the category. Try again.")}
      />

      {item.prompt && (
        <div className="story-field">
          <span>{item.kind === "sheet" && item.sources.length ? "Change" : "Prompt"}</span>
          <p className="small shot-prompt">{item.prompt}</p>
        </div>
      )}
      {sources.length > 0 && (
        <div className="story-field">
          <span>Made from</span>
          <div className="chips">
            {sources.map(({ id, found }) =>
              found ? (
                <button key={id} type="button" className="chip chip--source" onClick={() => onOpen(id)}>
                  {found.images[0] && <img src={found.images[0]} alt="" />}
                  {found.name}
                </button>
              ) : (
                <span key={id} className="chip chip--gone">Deleted item</span>
              ),
            )}
          </div>
        </div>
      )}

      {done && (
        <div className="inspector-actions inspector-actions--stack">
          {item.kind === "character" && (
            <button type="button" className="ghost" disabled={!!busy} onClick={() => void run("sheet", async () => onMade(await makeLibrarySheet(item.id)), "Couldn't start the character sheet. Try again.")}>
              {busy === "sheet" ? "Starting" : "Make character sheet"}
            </button>
          )}
          {isPicture && <button type="button" className="ghost" onClick={() => onUseAsReference(item.id)}>Use as a reference</button>}
        </div>
      )}
      {done && item.kind === "character" && <p className="muted small">A character sheet is one image with front, side, back and close-ups. Uses credits.</p>}
      {done && (item.kind === "character" || item.kind === "sheet") && (
        <SheetChanges onMake={async (change) => onMade(await makeLibrarySheet(item.id, change))} />
      )}

      {item.canRegenerate && !itemWorking(item) && (
        <div className="lib-regen">
          <button type="button" className="ghost" disabled={!!busy} onClick={() => void run("regen", async () => onMade(await regenerateLibraryItem(item.id)), "Couldn't regenerate it. Try again.")}>
            {busy === "regen" ? "Starting" : "Regenerate"}
          </button>
          <p className="muted small">Makes a new version from the same prompt; this one stays. Uses credits.</p>
        </div>
      )}

      {done && (
        <div className="inspector-actions">
          {item.kind === "video" && item.videoUrl ? (
            <a className="ghost" href={item.videoUrl} download={`${downloadName(0)}.mp4`}>Download</a>
          ) : (
            item.images.map((src, i) => (
              <a key={src} className="ghost" href={src} download={downloadName(i)}>{item.images.length > 1 ? `Download photo ${i + 1}` : "Download"}</a>
            ))
          )}
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      {!confirming ? (
        <button type="button" className="ghost danger align-start" onClick={() => setConfirming(true)}>Delete</button>
      ) : (
        <div className="confirm" role="group" aria-label="Confirm delete">
          <p className="small">Delete {item.name} from your Assets? Canvases that use it keep their copy. This can't be undone.</p>
          <div className="inspector-actions">
            <button
              type="button"
              className="ghost danger"
              autoFocus
              disabled={busy === "delete"}
              onClick={() =>
                void run(
                  "delete",
                  async () => {
                    await deleteLibraryItem(item.id);
                    onDeleted(item.id);
                  },
                  "Couldn't delete it. Try again.",
                )
              }
            >
              {busy === "delete" ? "Deleting" : "Delete"}
            </button>
            <button type="button" className="ghost" onClick={() => setConfirming(false)}>Keep it</button>
          </div>
        </div>
      )}
    </div>
  );
}

type AddProps = {
  how: "upload" | "generate";
  categories: LibraryCategory[];
  /** Category to start with. */
  category: string | null;
  /** Items to start with as references (generate only). */
  preset: string[];
  library: Library;
  onCategory: (cat: LibraryCategory) => void;
  onDone: (item: LibraryItem) => void;
  onCancel: () => void;
};

/** Add to Assets: upload photos (free), or describe an image or a character and generate it (uses credits). */
export function AddForm({ how: initialHow, categories, category: initialCategory, preset, library, onCategory, onDone, onCancel }: AddProps) {
  const [how, setHow] = useState(initialHow);
  const [kind, setKind] = useState<"image" | "character">(() => {
    const first = library.items.find((i) => i.id === preset[0]);
    return first && (first.kind === "character" || first.kind === "sheet") ? "character" : "image";
  });
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string | null>(() => initialCategory ?? defaultCategory(kind));
  const [photos, setPhotos] = useState<File[]>([]);
  const [prompt, setPrompt] = useState("");
  const [refs, setRefs] = useState<string[]>(preset);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const promptId = useId();
  const character = kind === "character";
  const fallbackName = character ? "Character" : "Image";
  const refItems = refs.map((id) => library.items.find((i) => i.id === id)).filter((i): i is LibraryItem => !!i && usable(i));

  const switchKind = (next: "image" | "character") => {
    setKind(next);
    // Follow the kind's usual category until the person picks one.
    if (!initialCategory && category === defaultCategory(kind)) setCategory(defaultCategory(next));
    if (next === "image" && photos.length > 1) setPhotos(photos.slice(0, 1));
  };

  const submit = async () => {
    setSending(true);
    setError(null);
    try {
      if (how === "upload") {
        const label = name.trim() || photos[0]?.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 40) || fallbackName;
        onDone(await uploadLibraryItem({ kind, name: label, category, photos }));
      } else {
        const label = name.trim() || prompt.trim().split(/\s+/).slice(0, 4).join(" ") || fallbackName;
        onDone(await generateLibraryItem({ kind, name: label, prompt, category, sourceIds: refItems.map((i) => i.id) }));
      }
    } catch (err) {
      setError(message(err, `Couldn't add the ${character ? "character" : "image"}. Try again.`));
    } finally {
      setSending(false);
    }
  };

  const canSend = how === "upload" ? photos.length > 0 : prompt.trim().length > 0;

  return (
    <form
      className="inspector-body"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3 className="inspector-title" tabIndex={-1} data-autofocus>{how === "upload" ? "Upload to Assets" : "Generate for Assets"}</h3>
      <div className="segmented" role="group" aria-label="How to add it">
        <button type="button" aria-pressed={how === "upload"} className={how === "upload" ? "on" : ""} onClick={() => setHow("upload")}>Upload</button>
        <button type="button" aria-pressed={how === "generate"} className={how === "generate" ? "on" : ""} onClick={() => setHow("generate")}>Generate</button>
      </div>
      <div className="segmented" role="group" aria-label="Kind">
        <button type="button" aria-pressed={kind === "image"} className={kind === "image" ? "on" : ""} onClick={() => switchKind("image")}>Image</button>
        <button type="button" aria-pressed={character} className={character ? "on" : ""} onClick={() => switchKind("character")}>Character</button>
      </div>

      <div className="story-field">
        <label htmlFor={nameId}>Name</label>
        <input id={nameId} className="text-input" type="text" maxLength={40} value={name} placeholder={character ? "Mia" : "Rooftop at dusk"} onChange={(e) => setName(e.target.value)} />
      </div>

      {how === "upload" ? (
        <div className="story-field">
          <span>{character ? "1 to 4 photos of the same person" : "Photo"}</span>
          <UploadCard key={kind} title={character ? "Character" : "Image"} icon={character ? <PersonIcon /> : <PinIcon />} max={character ? 4 : 1} files={photos} onChange={setPhotos} onError={setError} />
          <small className="muted">Uploading is free. Only upload photos you have the right to use.</small>
        </div>
      ) : (
        <>
          <div className="story-field">
            <label htmlFor={promptId}>{character ? "Describe them" : "Describe the image"}</label>
            <textarea
              id={promptId}
              className="text-input"
              rows={4}
              maxLength={PROMPT_MAX}
              value={prompt}
              placeholder={character ? "A woman in her 30s with short silver hair and a yellow raincoat" : "A quiet rooftop garden at dusk, city lights behind"}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
          <div className="story-field">
            <span>References (optional, up to {MAX_REFS})</span>
            {refItems.length > 0 && (
              <ul className="ref-list">
                {refItems.map((r) => (
                  <li key={r.id}>
                    <img src={r.images[0]} alt="" />
                    <span>{r.name}</span>
                    <button type="button" aria-label={`Remove ${r.name}`} onClick={() => setRefs(refs.filter((id) => id !== r.id))}>×</button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="ghost align-start" onClick={() => setPicking(true)}>{refItems.length ? "Change references" : "Pick from Assets"}</button>
          </div>
        </>
      )}

      <CategorySelect categories={categories} value={category} onChange={setCategory} onCreated={onCategory} />

      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="inspector-actions">
        <button type="submit" className="primary" disabled={!canSend || sending}>{sending ? "Adding" : how === "upload" ? "Add to Assets" : "Generate"}</button>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
      {how === "generate" && <p className="muted small">Uses credits.</p>}

      {picking && (
        <LibraryPicker
          title="Pick references"
          max={MAX_REFS}
          kinds={["image", "character", "sheet"]}
          confirmLabel={(n) => (n ? `Use ${n} as references` : "Use as references")}
          onPick={async (items) => {
            setRefs(items.map((i) => i.id));
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </form>
  );
}

type ManagerProps = {
  library: Library;
  onCategory: (cat: LibraryCategory) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
};

/** Add, rename and delete categories. Built-in ones stay as they are. */
export function CategoryManager({ library, onCategory, onDeleted, onClose }: ManagerProps) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = (id: string) => library.items.filter((i) => i.category === id).length;

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(message(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const rename = (cat: LibraryCategory) => {
    const next = names[cat.id]?.trim();
    setNames((all) => {
      const rest = { ...all };
      delete rest[cat.id];
      return rest;
    });
    if (!next || next === cat.name) return;
    void run(async () => onCategory(await renameCategory(cat.id, next)), "Couldn't rename the category. Try again.");
  };

  return (
    <Dialog title="Categories" onClose={onClose} className="dialog--small">
      <div className="dialog-body">
        <ul className="cat-list">
          {library.categories.map((cat) => (
            <li key={cat.id}>
              {cat.builtIn ? (
                <span className="cat-name">{cat.name}</span>
              ) : (
                <input
                  className="text-input"
                  aria-label={`Rename ${cat.name}`}
                  maxLength={40}
                  value={names[cat.id] ?? cat.name}
                  onChange={(e) => setNames({ ...names, [cat.id]: e.target.value })}
                  onBlur={() => rename(cat)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                />
              )}
              <span className="muted small cat-count">{count(cat.id)}</span>
              {cat.builtIn ? (
                <span className="muted small cat-note">Built in</span>
              ) : confirming === cat.id ? (
                <span className="cat-confirm">
                  <button
                    type="button"
                    className="ghost danger"
                    autoFocus
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await deleteCategory(cat.id);
                        onDeleted(cat.id);
                        setConfirming(null);
                      }, "Couldn't delete the category. Try again.")
                    }
                  >
                    Delete
                  </button>
                  <button type="button" className="ghost" onClick={() => setConfirming(null)}>Keep</button>
                </span>
              ) : (
                <button type="button" className="ghost danger cat-note" aria-label={`Delete ${cat.name}`} onClick={() => setConfirming(cat.id)}>Delete</button>
              )}
            </li>
          ))}
        </ul>
        {confirming && <p className="muted small">Its items move to Uncategorized.</p>}
        <form
          className="inline-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            void run(async () => {
              onCategory(await createCategory(newName));
              setNewName("");
            }, "Couldn't add the category. Try again.");
          }}
        >
          <input className="text-input" type="text" aria-label="New category name" maxLength={40} placeholder="New category, e.g. Vehicles" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button type="submit" className="primary" disabled={busy || !newName.trim()}>Add</button>
        </form>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
