import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, createGeneration, fetchCustomEffect, fetchEffects, fetchHistory, fetchMyEffects, fetchRecipe, workflowUrl, type Effect, type Generation } from "./api";
import Sidebar, { type FormState } from "./Sidebar";
import Stage from "./Stage";
import StoryView from "./Story";
import CanvasView from "./Canvas";
import CanvasList from "./CanvasList";
import Assets from "./Assets";
import HowItWorks from "./HowItWorks";
import LazyClip from "./LazyClip";
import Masonry from "./Masonry";
import Studio, { BLANK_RECIPE, type Draft } from "./Studio";
import { CheckIcon, ClockIcon, GridIcon, InfoIcon, PencilIcon, SearchIcon } from "./Icons";

type Tab = "effects" | "studio" | "history" | "how";

const viewFromUrl = () => new URLSearchParams(window.location.search).get("v");
const storyFromUrl = () => new URLSearchParams(window.location.search).get("story");
/** null: not in Canvas. "": the list of canvases. Anything else: one canvas. */
const canvasFromUrl = () => {
  const q = new URLSearchParams(window.location.search);
  return q.has("canvas") ? (q.get("canvas") ?? "") : null;
};
/** null: not in Assets. "": Assets. Anything else: Assets with that item open. */
const assetsFromUrl = () => {
  const q = new URLSearchParams(window.location.search);
  return q.has("assets") ? (q.get("assets") ?? "") : null;
};
const sharedEffect = () => new URLSearchParams(window.location.search).get("effect");

export default function App() {
  const [effects, setEffects] = useState<Effect[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("effects");
  const [search, setSearch] = useState("");
  const [viewId, setViewId] = useState<string | null>(viewFromUrl);
  const [seed, setSeed] = useState<Generation | null>(null);
  const [storyId, setStoryId] = useState<string | null>(storyFromUrl);
  const [canvasId, setCanvasId] = useState<string | null>(canvasFromUrl);
  const [assetsId, setAssetsId] = useState<string | null>(assetsFromUrl);
  const [history, setHistory] = useState<Generation[]>([]);
  const [draft, setDraft] = useState<Draft>({ recipe: BLANK_RECIPE, remixOf: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastText, setToastText] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    uploads: { character: [], location: [], product: [] },
    promptOn: true,
    prompt: "",
    resolution: "480P",
    aspectRatio: "9:16",
  });

  useEffect(() => {
    const shared = sharedEffect();
    Promise.all([
      fetchEffects(),
      fetchMyEffects().catch(() => [] as Effect[]),
      shared ? fetchCustomEffect(shared).catch(() => null) : null,
    ])
      .then(([builtIn, mine, linked]) => {
        const custom = linked && !mine.some((e) => e.id === linked.id) ? [linked, ...mine] : mine;
        setEffects([...custom, ...builtIn]);
        setSelected((cur) => cur ?? linked?.id ?? builtIn[0]?.id ?? null);
      })
      .catch(() => setError("Can't load effects. Refresh to try again."));
  }, []);

  const refreshHistory = useCallback(() => {
    fetchHistory().then(setHistory).catch(() => {});
  }, []);
  useEffect(refreshHistory, [refreshHistory]);

  // The open clip, story or canvas lives in the URL, so refresh, back and shared links all work.
  useEffect(() => {
    const onPop = () => {
      setViewId(viewFromUrl());
      setStoryId(storyFromUrl());
      setCanvasId(canvasFromUrl());
      setAssetsId(assetsFromUrl());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const openClip = useCallback((id: string | null, gen: Generation | null = null) => {
    window.history.pushState(null, "", id ? `/?v=${encodeURIComponent(id)}` : "/");
    setSeed(gen);
    setViewId(id);
    setStoryId(null);
    setCanvasId(null);
    setAssetsId(null);
  }, []);
  /** "" opens the list of canvases. */
  const openCanvas = useCallback((id: string) => {
    window.history.pushState(null, "", id ? `/?canvas=${encodeURIComponent(id)}` : "/?canvas");
    setCanvasId(id);
    setViewId(null);
    setStoryId(null);
    setAssetsId(null);
  }, []);
  const openAssets = useCallback(() => {
    window.history.pushState(null, "", "/?assets");
    setAssetsId("");
    setViewId(null);
    setStoryId(null);
    setCanvasId(null);
  }, []);
  const inCanvas = canvasId !== null;
  const inAssets = assetsId !== null && !inCanvas;
  const open = viewId ?? storyId ?? canvasId ?? assetsId;

  const showTab = (next: Tab) => {
    setTab(next);
    if (open !== null) openClip(null);
    if (next === "history") refreshHistory();
  };

  const toast = useCallback((message: string) => {
    setToastText(message);
    window.setTimeout(() => setToastText(null), 2200);
  }, []);

  const effect = effects.find((e) => e.id === selected) ?? null;

  const counts = useMemo(
    () => ({ characters: form.uploads.character.length, locations: form.uploads.location.length, products: form.uploads.product.length }),
    [form.uploads],
  );

  const remix = async () => {
    if (!effect) return;
    setError(null);
    try {
      const { recipe } = await fetchRecipe(effect.id);
      setDraft({ recipe: { ...recipe, name: `${recipe.name} Remix`.slice(0, 40) }, remixOf: effect.id });
      showTab("studio");
    } catch {
      setError("Couldn't open that effect. Try again.");
    }
  };

  const copyEffectLink = async () => {
    if (!effect) return;
    const url = `${window.location.origin}/?effect=${encodeURIComponent(effect.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      toast(url);
    }
  };

  const onEffectSaved = (saved: Effect) => {
    setEffects((list) => [saved, ...list]);
    setSelected(saved.id);
    setDraft({ recipe: BLANK_RECIPE, remixOf: null });
    showTab("effects");
    toast(`${saved.label} saved. Add a photo and hit Generate.`);
  };

  const generate = async () => {
    if (!effect) return;
    setBusy(true);
    setError(null);
    try {
      const gen = await createGeneration({
        effect: effect.id,
        uploads: form.uploads,
        prompt: form.promptOn ? form.prompt : undefined,
        resolution: form.resolution,
        aspectRatio: form.aspectRatio,
      });
      openClip(gen.id, gen);
      refreshHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? effects.filter((e) => `${e.label} ${e.description}`.toLowerCase().includes(q)) : effects;
  }, [effects, search]);

  const onStageDone = useCallback(() => refreshHistory(), [refreshHistory]);

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => showTab("effects")}>
          <img src="/favicon.svg" alt="" width={22} height={22} /> hypereel
        </button>
        <nav className="topnav" aria-label="Main">
          <button type="button" className={open === null && tab === "effects" ? "on" : ""} onClick={() => showTab("effects")}>Effects</button>
          <button type="button" className={inCanvas ? "on" : ""} aria-current={inCanvas ? "page" : undefined} onClick={() => openCanvas("")}>Canvas</button>
          <button type="button" className={inAssets ? "on" : ""} aria-current={inAssets ? "page" : undefined} onClick={openAssets}>Assets</button>
          <button type="button" className={open === null && tab === "history" ? "on" : ""} onClick={() => showTab("history")}>History</button>
          <a href="https://github.com/HideInSky/hypereel" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
        <span className="topbar-credit">Built with MiniMax H3 on ComfyUI</span>
      </header>

      <div className="workspace">
        {inCanvas ? (
          <main className="panel panel--canvas">
            {canvasId ? <CanvasView key={canvasId} id={canvasId} effects={effects} onList={() => openCanvas("")} toast={toast} /> : <CanvasList onOpen={openCanvas} />}
          </main>
        ) : inAssets ? (
          <main className="panel panel--assets">
            <Assets focusId={assetsId || null} toast={toast} onCanvas={() => openCanvas("")} />
          </main>
        ) : (
        <>
        <Sidebar
          effect={effect}
          form={form}
          setForm={setForm}
          busy={busy}
          error={error}
          setError={setError}
          onChangeEffect={() => showTab("effects")}
          onGenerate={() => void generate()}
          onRemix={() => void remix()}
          onCopyLink={() => void copyEffectLink()}
          workflowHref={effect ? workflowUrl(effect.id, counts, { note: form.promptOn ? form.prompt : undefined, resolution: form.resolution, aspectRatio: form.aspectRatio }) : null}
        />

        <main className="panel">
          <div className="panel-bar">
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={open === null && tab === "effects"} className={open === null && tab === "effects" ? "on" : ""} onClick={() => showTab("effects")}><GridIcon /> Effects</button>
              <button type="button" role="tab" aria-selected={open === null && tab === "studio"} className={open === null && tab === "studio" ? "on" : ""} onClick={() => showTab("studio")}><PencilIcon /> Studio</button>
              <button type="button" role="tab" aria-selected={open === null && tab === "history"} className={open === null && tab === "history" ? "on" : ""} onClick={() => showTab("history")}><ClockIcon /> History</button>
              <button type="button" role="tab" aria-selected={open === null && tab === "how"} className={open === null && tab === "how" ? "on" : ""} onClick={() => showTab("how")}><InfoIcon /> How it works</button>
            </div>
            {open === null && tab === "effects" && (
              <label className="search">
                <SearchIcon />
                <input type="search" placeholder="Search" aria-label="Search effects" value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
            )}
          </div>

          <div className="panel-body">
            {storyId ? (
              <StoryView id={storyId} seed={null} onBack={() => showTab("effects")} onOpenClip={(id) => openClip(id)} toast={toast} />
            ) : viewId ? (
              <Stage id={viewId} seed={seed} onBack={() => showTab("effects")} onDone={onStageDone} toast={toast} />
            ) : tab === "effects" ? (
              shown.length ? (
                <Masonry
                  items={shown}
                  itemKey={(e) => e.id}
                  ratio={(e) => e.ratio}
                  renderItem={(e) => (
                    <button
                      type="button"
                      className={`effect-tile${e.id === selected ? " effect-tile--on" : ""}`}
                      aria-pressed={e.id === selected}
                      title={e.description}
                      style={{ aspectRatio: e.ratio.replace(":", " / ") }}
                      onClick={() => setSelected(e.id)}
                    >
                      {e.preview ? <LazyClip src={e.preview} poster={e.poster} /> : <span className="tile-placeholder">{e.custom ? "Your effect" : "No example yet"}</span>}
                      {e.id === selected && <span className="tile-check"><CheckIcon /></span>}
                      <span className="tile-text">
                        <span className="tile-label">{e.label}</span>
                        <span className="tile-desc">{e.description}</span>
                      </span>
                    </button>
                  )}
                />
              ) : (
                <p className="muted empty">No effects match that search.</p>
              )
            ) : tab === "studio" ? (
              <Studio draft={draft} setDraft={setDraft} counts={counts} onSaved={onEffectSaved} />
            ) : tab === "history" ? (
              history.length ? (
                <div className="effects-grid">
                  {history.map((g) => (
                    <button type="button" key={g.id} className="effect-tile" onClick={() => openClip(g.id, g)}>
                      {g.videoUrl ? <video src={g.videoUrl} poster={g.posterUrl ?? undefined} muted loop playsInline preload="metadata" onMouseEnter={(ev) => void ev.currentTarget.play()} onMouseLeave={(ev) => ev.currentTarget.pause()} /> : g.posterUrl && <img src={g.posterUrl} alt="" />}
                      {g.status !== "succeeded" && <span className={`tile-status tile-status--${g.status}`}>{g.status === "failed" ? "Failed" : "Rendering"}</span>}
                      <span className="tile-text"><span className="tile-label">{g.effectLabel}</span></span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted empty">Your clips will show up here.</p>
              )
            ) : (
              <HowItWorks />
            )}
          </div>
        </main>
        </>
        )}
      </div>

      {toastText && <div className="toast" role="status">{toastText}</div>}
    </div>
  );
}
