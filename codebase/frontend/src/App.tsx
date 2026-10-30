import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, createGeneration, fetchEffects, fetchHistory, type Effect, type Generation } from "./api";
import Sidebar, { type FormState } from "./Sidebar";
import Stage from "./Stage";
import HowItWorks from "./HowItWorks";
import { CheckIcon, ClockIcon, GridIcon, InfoIcon, SearchIcon } from "./Icons";

type Tab = "effects" | "history" | "how";

const viewFromUrl = () => new URLSearchParams(window.location.search).get("v");

export default function App() {
  const [effects, setEffects] = useState<Effect[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("effects");
  const [search, setSearch] = useState("");
  const [viewId, setViewId] = useState<string | null>(viewFromUrl);
  const [seed, setSeed] = useState<Generation | null>(null);
  const [history, setHistory] = useState<Generation[]>([]);
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
    fetchEffects()
      .then((list) => {
        setEffects(list);
        setSelected((cur) => cur ?? list[0]?.id ?? null);
      })
      .catch(() => setError("Can't load effects. Refresh to try again."));
  }, []);

  const refreshHistory = useCallback(() => {
    fetchHistory().then(setHistory).catch(() => {});
  }, []);
  useEffect(refreshHistory, [refreshHistory]);

  // The open clip lives in the URL, so refresh, back and shared links all work.
  useEffect(() => {
    const onPop = () => setViewId(viewFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const openClip = useCallback((id: string | null, gen: Generation | null = null) => {
    window.history.pushState(null, "", id ? `/?v=${encodeURIComponent(id)}` : "/");
    setSeed(gen);
    setViewId(id);
  }, []);

  const showTab = (next: Tab) => {
    setTab(next);
    if (viewId) openClip(null);
    if (next === "history") refreshHistory();
  };

  const toast = useCallback((message: string) => {
    setToastText(message);
    window.setTimeout(() => setToastText(null), 2200);
  }, []);

  const effect = effects.find((e) => e.id === selected) ?? null;

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
          <button type="button" className={!viewId && tab === "effects" ? "on" : ""} onClick={() => showTab("effects")}>Effects</button>
          <button type="button" className={!viewId && tab === "history" ? "on" : ""} onClick={() => showTab("history")}>History</button>
          <a href="https://github.com/HideInSky/hypereel" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
        <span className="topbar-credit">Built with MiniMax H3 on ComfyUI</span>
      </header>

      <div className="workspace">
        <Sidebar
          effect={effect}
          form={form}
          setForm={setForm}
          busy={busy}
          error={error}
          setError={setError}
          onChangeEffect={() => showTab("effects")}
          onGenerate={() => void generate()}
        />

        <main className="panel">
          <div className="panel-bar">
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={!viewId && tab === "effects"} className={!viewId && tab === "effects" ? "on" : ""} onClick={() => showTab("effects")}><GridIcon /> Effects</button>
              <button type="button" role="tab" aria-selected={!viewId && tab === "history"} className={!viewId && tab === "history" ? "on" : ""} onClick={() => showTab("history")}><ClockIcon /> History</button>
              <button type="button" role="tab" aria-selected={!viewId && tab === "how"} className={!viewId && tab === "how" ? "on" : ""} onClick={() => showTab("how")}><InfoIcon /> How it works</button>
            </div>
            {!viewId && tab === "effects" && (
              <label className="search">
                <SearchIcon />
                <input type="search" placeholder="Search" aria-label="Search effects" value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
            )}
          </div>

          <div className="panel-body">
            {viewId ? (
              <Stage id={viewId} seed={seed} onBack={() => showTab("effects")} onDone={onStageDone} toast={toast} />
            ) : tab === "effects" ? (
              shown.length ? (
                <div className="effects-grid">
                  {shown.map((e) => (
                    <button
                      type="button"
                      key={e.id}
                      className={`effect-tile${e.id === selected ? " effect-tile--on" : ""}`}
                      aria-pressed={e.id === selected}
                      title={e.description}
                      onClick={() => setSelected(e.id)}
                    >
                      <video src={e.preview} autoPlay muted loop playsInline preload="metadata" />
                      {e.id === selected && <span className="tile-check"><CheckIcon /></span>}
                      <span className="tile-text">
                        <span className="tile-label">{e.label}</span>
                        <span className="tile-desc">{e.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted empty">No effects match that search.</p>
              )
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
      </div>

      {toastText && <div className="toast" role="status">{toastText}</div>}
    </div>
  );
}
