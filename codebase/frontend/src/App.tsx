import { useCallback, useEffect, useState } from "react";
import { fetchGenres, type Generation, type Genre } from "./api";
import { useGeneration } from "./useGeneration";
import Compose from "./Compose";
import Rendering from "./Rendering";
import Result from "./Result";
import Failed from "./Failed";

/**
 * The whole app lives on one URL and the query string decides what we show:
 *   /                → compose (pick photo + genre)
 *   /?remix=<id>     → compose, pre-loaded with that generation's photo
 *   /?v=<id>         → rendering / result / failed view for that generation
 * Keeping it in the URL means refresh, back button and sharing all just work.
 */
type Route = { page: "compose"; remixId: string | null } | { page: "view"; id: string };

function parseRoute(): Route {
  const params = new URLSearchParams(window.location.search);
  const v = params.get("v");
  if (v) return { page: "view", id: v };
  return { page: "compose", remixId: params.get("remix") };
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseRoute);
  // A Generation we already hold when navigating (avoids a loading flash).
  const [seed, setSeed] = useState<Generation | null>(null);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  // Back/forward buttons fire "popstate": re-read the URL.
  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    fetchGenres().then(setGenres).catch(() => setGenres([]));
  }, []);

  /** Change the URL (adds a history entry) and re-render for it. */
  const navigate = useCallback((search: string, gen: Generation | null = null) => {
    window.history.pushState(null, "", search ? `/?${search}` : "/");
    setSeed(gen);
    setRoute(parseRoute());
    window.scrollTo({ top: 0 });
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => navigate("")} aria-label="hypereel home">
          🎬 hypereel
        </button>
      </header>

      <main className="page">
        {route.page === "compose" ? (
          <Compose
            key={route.remixId ?? "fresh"}
            genres={genres}
            remixId={route.remixId}
            onSubmitted={(gen) => navigate(`v=${gen.id}`, gen)}
            onOpen={(id) => navigate(`v=${id}`)}
          />
        ) : (
          <GenerationView
            key={route.id}
            id={route.id}
            seed={seed}
            genres={genres}
            onRemix={(id) => navigate(`remix=${id}`)}
            onFresh={() => navigate("")}
            showToast={showToast}
          />
        )}
      </main>

      <footer className="footer">
        Made with <strong>MiniMax H3</strong> on <strong>ComfyUI</strong> · Comfy Cloud
      </footer>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

type ViewProps = {
  id: string;
  seed: Generation | null;
  genres: Genre[];
  onRemix: (id: string) => void;
  onFresh: () => void;
  showToast: (msg: string) => void;
};

/** Picks Rendering / Result / Failed depending on the generation's status. */
function GenerationView({ id, seed, genres, onRemix, onFresh, showToast }: ViewProps) {
  const { gen, notFound } = useGeneration(id, seed);

  if (notFound) {
    return <Failed title="That clip doesn't exist" message="Maybe the link got mangled. Let's make a new one." onRetry={onFresh} retryLabel="✨ Make your own" />;
  }
  if (!gen) {
    return (
      <div className="card center muted">
        <p>Loading…</p>
      </div>
    );
  }
  if (gen.status === "succeeded" && gen.videoUrl) {
    return <Result gen={gen} genres={genres} onRemix={() => onRemix(gen.id)} onFresh={onFresh} showToast={showToast} />;
  }
  if (gen.status === "failed") {
    return (
      <Failed
        title="The director walked off set"
        message={gen.error ?? "Something went wrong while rendering."}
        posterUrl={gen.posterUrl}
        onRetry={() => onRemix(gen.id)}
        retryLabel="🔁 Try again"
      />
    );
  }
  return <Rendering gen={gen} genres={genres} />;
}
