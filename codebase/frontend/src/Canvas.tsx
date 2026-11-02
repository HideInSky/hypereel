import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, deleteAsset, deleteVideo, fetchStory, updateCanvas, videoStory, type Asset, type Canvas, type CanvasVideo, type Effect, type Shot, type ShotSide } from "./api";
import Board, { type BoardEdge, type BoardNode } from "./Board";
import { AssetDetails, AssetForm, VideoDetails, VideoForm } from "./CanvasPanels";
import StoryView from "./Story";
import { MODE_LABEL, type Selection } from "./StoryTimeline";
import { useBoardStories, useCanvas } from "./useCanvas";

/** Card size on the board at 100%. The server spaces new cards 340 px apart. */
const CARD_W = 260;
const CARD_H = 220;
const STEP = 340;
const NUDGE = 10;

type Pick = { kind: "asset"; id: string } | { kind: "video"; id: string } | { kind: "shot"; storyId: string; id: string } | null;
type Tool = { kind: "image" | "character" | "video"; preset: string[] } | null;
type Strip = { storyId: string; cue: { selection: Selection; key: number } | null } | null;

type Props = {
  id: string;
  effects: Effect[];
  onList: () => void;
  toast: (message: string) => void;
};

const working = (status: string) => status === "queued" || status === "running";
const ASSET_LABEL: Record<Asset["kind"], string> = { image: "Image", character: "Character", sheet: "Character sheet" };

/** One canvas: a free board of assets and videos, an inspector, and a docked story strip. */
export default function CanvasView({ id, effects, onList, toast }: Props) {
  const { canvas, cards, notFound, accept, moveCard, viewport, setViewport, loadedViewport, saveError } = useCanvas(id);
  const storyIds = useMemo(() => (canvas ? canvas.videos.flatMap((v) => (v.storyId ? [v.storyId] : [])) : []), [canvas]);
  const { stories, put } = useBoardStories(storyIds);
  const [pick, setPick] = useState<Pick>(null);
  const [tool, setTool] = useState<Tool>(null);
  const [strip, setStrip] = useState<Strip>(null);
  const [confirming, setConfirming] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const [title, setTitle] = useState<string | null>(null);
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});

  // On the document, so keys still work after focus falls back to the page (e.g. a closed dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // A brand-new viewport (never panned) frames whatever is on the board.
  useEffect(() => {
    const untouched = viewport.x === 0 && viewport.y === 0 && viewport.zoom === 1;
    if (!loadedViewport || !untouched) return;
    // Server cards start at the origin; leave a margin so the first one isn't flush in the corner.
    if (cards.length) setFitRequest((n) => n + 1);
    else setViewport({ x: 48, y: 48, zoom: 1 });
    // Only on first load.
  }, [loadedViewport]);

  // On phones the strip sits under the board: bring it into view when a story opens.
  const stripId = strip?.storyId;
  useEffect(() => {
    if (!stripId) return;
    const el = document.querySelector(".canvas-strip");
    if (el && el.getBoundingClientRect().top > window.innerHeight - 120) {
      el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }
  }, [stripId]);

  const select = useCallback((next: Pick) => {
    setPick(next);
    setTool(null);
    setConfirming(false);
  }, []);

  const openStory = useCallback(
    async (video: CanvasVideo, side?: ShotSide, shotId?: string) => {
      if (!canvas) return;
      let storyId = video.storyId;
      if (!storyId) {
        storyId = (await videoStory(canvas.id, video.id)).storyId;
        const made = storyId;
        accept((c) => c && { ...c, videos: c.videos.map((v) => (v.id === video.id ? { ...v, storyId: made } : v)) });
      }
      const story = stories[storyId] ?? (await fetchStory(storyId));
      put(story);
      const original = story.shots.find((s) => s.mode === "original");
      const anchor = shotId ?? original?.id;
      const selection: Selection = side && anchor ? { kind: "new", anchorId: anchor, side } : anchor ? { kind: "shot", id: anchor } : null;
      setStrip({ storyId, cue: { selection, key: Date.now() } });
    },
    [canvas, stories, accept, put],
  );

  if (notFound) {
    return (
      <div className="stage stage--message">
        <h2>Canvas not found</h2>
        <button type="button" className="ghost" onClick={onList}>See your canvases</button>
      </div>
    );
  }
  if (!canvas) return <div className="stage stage--message"><p className="muted">Loading</p></div>;

  const owner = canvas.isOwner;
  const assetsById = new Map(canvas.assets.map((a) => [a.id, a]));
  const videosById = new Map(canvas.videos.map((v) => [v.id, v]));
  const cardOf = new Map(cards.map((c) => [`${c.kind}:${c.refId}`, c]));

  // Cards the server keeps, then each video's story shots as a row through it.
  const nodes: BoardNode[] = [];
  const edges: BoardEdge[] = [];
  const pickedCard = pick && pick.kind !== "shot" ? cardOf.get(`${pick.kind}:${pick.id}`)?.id : undefined;
  for (const card of cards) {
    if (card.kind === "asset") {
      const asset = assetsById.get(card.refId);
      if (!asset) continue;
      nodes.push({
        id: card.id,
        x: card.x,
        y: card.y,
        w: CARD_W,
        h: CARD_H,
        draggable: owner,
        selected: card.id === pickedCard,
        label: `${ASSET_LABEL[asset.kind]}: ${asset.name}${working(asset.status) ? ", being made" : asset.status === "failed" ? ", failed" : ""}`,
        className: `board-card--${asset.kind}`,
        content: <AssetCard asset={asset} />,
      });
      for (const src of asset.sources) {
        const from = cardOf.get(`asset:${src}`);
        if (from) edges.push({ from: from.id, to: card.id, on: from.id === pickedCard || card.id === pickedCard });
      }
    } else {
      const video = videosById.get(card.refId);
      if (!video) continue;
      nodes.push({
        id: card.id,
        x: card.x,
        y: card.y,
        w: CARD_W,
        h: CARD_H,
        draggable: owner,
        selected: card.id === pickedCard,
        label: `Video: ${video.effectLabel}${working(video.status) ? ", rendering" : video.status === "failed" ? ", failed" : ""}`,
        className: "board-card--video",
        content: <VideoCard video={video} />,
      });
      for (const assetId of video.assetIds) {
        const from = cardOf.get(`asset:${assetId}`);
        if (from) edges.push({ from: from.id, to: card.id, on: from.id === pickedCard || card.id === pickedCard });
      }
      const story = video.storyId ? stories[video.storyId] : undefined;
      const at = story ? story.shots.findIndex((s) => s.mode === "original") : -1;
      if (story && at >= 0) {
        const row = story.shots.map((shot, i) => ({ shot, nodeId: i === at ? card.id : `shot:${shot.id}`, dx: (i - at) * STEP }));
        for (const { shot, nodeId, dx } of row) {
          if (nodeId === card.id) continue;
          const on = pick?.kind === "shot" && pick.id === shot.id;
          nodes.push({
            id: nodeId,
            x: card.x + dx,
            y: card.y,
            w: CARD_W,
            h: CARD_H,
            draggable: false,
            selected: on,
            label: `${MODE_LABEL[shot.mode]} shot ${shot.side ?? ""} ${video.effectLabel}${working(shot.status) ? ", rendering" : shot.status === "failed" ? ", failed" : ""}`,
            className: "board-card--shot",
            content: <ShotCard shot={shot} />,
          });
        }
        for (let i = 0; i < row.length - 1; i++) {
          const a = row[i]!;
          const b = row[i + 1]!;
          edges.push({ from: a.nodeId, to: b.nodeId, story: true, on: !!strip && strip.storyId === story.id });
        }
      }
    }
  }

  const onSelectNode = (nodeId: string | null) => {
    if (!nodeId) return select(null);
    if (nodeId.startsWith("shot:")) {
      const shotId = nodeId.slice(5);
      const video = canvas.videos.find((v) => v.storyId && stories[v.storyId]?.shots.some((s) => s.id === shotId));
      if (!video?.storyId) return;
      select({ kind: "shot", storyId: video.storyId, id: shotId });
      void openStory(video, undefined, shotId).catch(() => toast("Couldn't open the story. Try again."));
      return;
    }
    const card = cards.find((c) => c.id === nodeId);
    if (card) select({ kind: card.kind, id: card.refId });
  };

  keyHandler.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    // Typing in a field, or working in the story strip, never moves or deletes board cards.
    if (target.closest("input, textarea, select, [contenteditable='true'], .canvas-strip, .toast")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") {
      if (confirming) setConfirming(false);
      else if (tool) setTool(null);
      else select(null);
      return;
    }
    if (!owner || !pick || pick.kind === "shot") return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      setConfirming(true);
      return;
    }
    const step = e.shiftKey ? NUDGE * 5 : NUDGE;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    const card = cardOf.get(`${pick.kind}:${pick.id}`);
    if (delta && card) {
      e.preventDefault();
      moveCard(card.id, card.x + delta[0]!, card.y + delta[1]!);
    }
  };

  /** Take the server's copy and select whatever it added. */
  const added = (next: Canvas) => {
    const knownAssets = new Set(canvas.assets.map((a) => a.id));
    const knownVideos = new Set(canvas.videos.map((v) => v.id));
    accept(next);
    const asset = next.assets.find((a) => !knownAssets.has(a.id));
    const video = next.videos.find((v) => !knownVideos.has(v.id));
    select(video ? { kind: "video", id: video.id } : asset ? { kind: "asset", id: asset.id } : null);
  };

  const pickedAsset = pick?.kind === "asset" ? assetsById.get(pick.id) : undefined;
  const pickedVideo = pick?.kind === "video" ? videosById.get(pick.id) : undefined;
  const pickedShot = pick?.kind === "shot" ? stories[pick.storyId]?.shots.find((s) => s.id === pick.id) : undefined;

  let panel = null;
  if (tool?.kind === "video") {
    panel = <VideoForm key="video" canvas={canvas} effects={effects} preset={tool.preset} onDone={added} onCancel={() => setTool(null)} />;
  } else if (tool) {
    panel = <AssetForm key={tool.kind} canvas={canvas} kind={tool.kind} preset={tool.preset} onDone={added} onCancel={() => setTool(null)} />;
  } else if (pickedAsset) {
    panel = (
      <AssetDetails
        key={pickedAsset.id}
        canvas={canvas}
        asset={pickedAsset}
        confirming={confirming}
        setConfirming={setConfirming}
        onChanged={added}
        onDelete={async () => {
          accept(await deleteAsset(canvas.id, pickedAsset.id));
          select(null);
        }}
        onUseAsReference={() => setTool({ kind: "image", preset: [pickedAsset.id] })}
        onMakeVideo={() => setTool({ kind: "video", preset: [pickedAsset.id] })}
      />
    );
  } else if (pickedVideo && !(strip && strip.storyId === pickedVideo.storyId)) {
    // While its story strip is open, the strip is where this video is edited.
    panel = (
      <VideoDetails
        key={pickedVideo.id}
        canvas={canvas}
        video={pickedVideo}
        confirming={confirming}
        setConfirming={setConfirming}
        onDelete={async () => {
          accept(await deleteVideo(canvas.id, pickedVideo.id));
          if (strip && strip.storyId === pickedVideo.storyId) setStrip(null);
          select(null);
        }}
        onStory={(side) => openStory(pickedVideo, side)}
      />
    );
  } else if (pickedShot && !strip) {
    panel = (
      <div className="inspector-body">
        <span className={`kind-tag kind-tag--${pickedShot.mode}`}>{MODE_LABEL[pickedShot.mode]}</span>
        <h3 className="inspector-title">A shot in this story</h3>
        <p className="muted small">Change it, remove it or add sound in the story strip below.</p>
        {pickedShot.status === "failed" && <p className="form-error">This shot didn't render. Remove it in the strip before you export.</p>}
      </div>
    );
  }

  const rename = async (next: string) => {
    setTitle(null);
    const clean = next.trim();
    if (!clean || clean === canvas.title) return;
    try {
      accept(await updateCanvas(canvas.id, { title: clean }));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't rename the canvas. Try again.");
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(canvas.shareUrl);
      toast("Link copied");
    } catch {
      toast(canvas.shareUrl);
    }
  };

  const openTool = (kind: "image" | "character" | "video") => {
    const preset = kind === "video" && pickedAsset ? [pickedAsset.id] : [];
    setPick(null);
    setConfirming(false);
    setTool({ kind, preset });
  };

  return (
    <div className="canvas">
      <div className="canvas-bar">
        <button type="button" className="story-back" onClick={onList}>All canvases</button>
        {owner ? (
          <input
            className="canvas-title"
            aria-label="Canvas name"
            maxLength={60}
            value={title ?? canvas.title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={(e) => void rename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setTitle(null);
            }}
          />
        ) : (
          <h2 className="canvas-title">{canvas.title}</h2>
        )}
        <div className="canvas-tools">
          {owner && (
            <>
              <button type="button" className={`ghost${tool?.kind === "image" ? " is-on" : ""}`} onClick={() => openTool("image")}>Add image</button>
              <button type="button" className={`ghost${tool?.kind === "character" ? " is-on" : ""}`} onClick={() => openTool("character")}>Add character</button>
              <button type="button" className={`primary${tool?.kind === "video" ? " is-on" : ""}`} onClick={() => openTool("video")}>Make a video</button>
            </>
          )}
          <button type="button" className="ghost" onClick={() => void copyLink()}>Copy link</button>
        </div>
      </div>
      {saveError && <p className="form-error canvas-save-error" role="alert">{saveError}</p>}

      <div className="canvas-main">
        <Board nodes={nodes} edges={edges} viewport={viewport} setViewport={setViewport} onMove={moveCard} onSelect={onSelectNode} fitRequest={fitRequest} />
        {!nodes.length && (
          <div className="canvas-empty">
            <strong>{owner ? "Start with a character" : "Nothing on this canvas yet"}</strong>
            {owner && <p className="muted small">Add a character or an image, then make a video from them. Lines show what was made from what.</p>}
            {owner && (
              <div className="inspector-actions">
                <button type="button" className="primary" onClick={() => openTool("character")}>Add character</button>
                <button type="button" className="ghost" onClick={() => openTool("image")}>Add image</button>
              </div>
            )}
          </div>
        )}
        {panel && (
          <aside className="canvas-inspector" aria-label="Details">
            <button type="button" className="canvas-inspector-close" aria-label="Close details" onClick={() => select(null)}>×</button>
            {panel}
          </aside>
        )}
      </div>

      {strip && (
        <section className="canvas-strip" aria-label="Story">
          <StoryView
            key={strip.storyId}
            id={strip.storyId}
            seed={stories[strip.storyId] ?? null}
            docked
            cue={strip.cue}
            onStory={put}
            onBack={() => setStrip(null)}
            toast={toast}
          />
        </section>
      )}
    </div>
  );
}

function Status({ status, progress }: { status: string; progress?: number }) {
  if (working(status)) {
    return (
      <span className="cc-status">
        {progress === undefined ? "Making it" : "Rendering"}
        {progress !== undefined && <span className="tl-shot-progress"><span style={{ width: `${Math.max(4, progress)}%` }} /></span>}
      </span>
    );
  }
  if (status === "failed") return <span className="cc-status cc-status--failed">Didn't work</span>;
  return null;
}

function AssetCard({ asset }: { asset: Asset }) {
  const stack = asset.kind === "character" && asset.images.length > 1;
  return (
    <>
      <span className={`cc-frame${stack ? " cc-frame--stack" : ""}${asset.kind === "sheet" ? " cc-frame--sheet" : ""}`}>
        {stack
          ? asset.images.slice(0, 3).map((src, i, shown) => {
              const off = i - (shown.length - 1) / 2; // -1..1, centred
              return <img key={src} src={src} alt="" draggable={false} className="cc-print" style={{ transform: `translateX(${off * 46}px) rotate(${off * 6}deg)`, zIndex: i + 1 }} />;
            })
          : asset.images[0] && <img src={asset.images[0]} alt="" draggable={false} />}
        <Status status={asset.status} />
      </span>
      <span className="cc-foot">
        <span className={`cc-kind cc-kind--${asset.kind}`}>{ASSET_LABEL[asset.kind]}</span>
        <span className="cc-name">{asset.name}</span>
      </span>
    </>
  );
}

function VideoCard({ video }: { video: CanvasVideo }) {
  return (
    <>
      <span className="cc-frame">
        {video.videoUrl ? (
          <video muted playsInline preload="metadata" src={`${video.videoUrl}#t=0.4`} tabIndex={-1} />
        ) : (
          video.posterUrl && <img src={video.posterUrl} alt="" draggable={false} />
        )}
        <Status status={video.status} progress={video.progress} />
      </span>
      <span className="cc-foot">
        <span className="cc-kind cc-kind--video">Video</span>
        <span className="cc-name">{video.effectLabel}</span>
      </span>
    </>
  );
}

function ShotCard({ shot }: { shot: Shot }) {
  return (
    <>
      <span className="cc-frame">
        {shot.videoUrl && <video muted playsInline preload="metadata" src={`${shot.videoUrl}#t=0.4`} tabIndex={-1} />}
        <Status status={shot.status} progress={shot.progress} />
      </span>
      <span className="cc-foot">
        <span className={`cc-kind cc-kind--${shot.mode}`}>{MODE_LABEL[shot.mode]}</span>
        <span className="cc-name">{shot.side === "before" ? "Shot before" : "Shot after"}</span>
      </span>
    </>
  );
}
