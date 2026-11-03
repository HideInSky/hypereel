import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { Viewport } from "./api";

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2.5;
const DOT_GAP = 24;
const DRAG_SLOP = 4; // px a pointer must travel before a press becomes a drag

export type BoardNode = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  draggable: boolean;
  selected: boolean;
  /** Extra class, e.g. "board-card--shot". */
  className?: string;
  content: ReactNode;
};

export type BoardEdge = { from: string; to: string; on: boolean; story?: boolean };

type Props = {
  nodes: BoardNode[];
  edges: BoardEdge[];
  viewport: Viewport;
  setViewport: (next: Viewport | ((v: Viewport) => Viewport)) => void;
  onMove: (id: string, x: number, y: number, save: boolean) => void;
  onSelect: (id: string | null) => void;
  /** Bump to fit every card in view. */
  fitRequest: number;
  /** Frame just these cards (e.g. a story row when its strip opens). A new `key` reframes. */
  focus?: { ids: string[]; key: number } | null;
};

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

type Gesture =
  | { type: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { type: "card"; id: string; sx: number; sy: number; cx: number; cy: number; moved: boolean; draggable: boolean }
  | { type: "pinch"; dist: number; mx: number; my: number; view: Viewport };

/**
 * A pan-and-zoom surface. Drag empty space (one finger on touch) to pan, drag a card to
 * move it, scroll to pan, pinch or ctrl/cmd-scroll to zoom. Cards and lines live in one
 * "world" layer that is translated and scaled as a whole.
 */
export default function Board({ nodes, edges, viewport, setViewport, onMove, onSelect, fitRequest, focus }: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const { x, y, zoom } = viewport;
  const latestNodes = useRef(nodes);
  latestNodes.current = nodes;

  /** Zoom by `factor`, keeping the point under (cx, cy) on screen still. */
  const zoomAt = useCallback(
    (cx: number, cy: number, factor: number) => {
      const rect = surface.current?.getBoundingClientRect();
      if (!rect) return;
      const px = cx - rect.left;
      const py = cy - rect.top;
      setViewport((v) => {
        const next = clampZoom(v.zoom * factor);
        const wx = (px - v.x) / v.zoom;
        const wy = (py - v.y) / v.zoom;
        return { x: px - wx * next, y: py - wy * next, zoom: next };
      });
    },
    [setViewport],
  );

  const zoomCenter = (factor: number) => {
    const rect = surface.current?.getBoundingClientRect();
    if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };

  const fit = useCallback((only?: string[]) => {
    const el = surface.current;
    const list = only ? latestNodes.current.filter((n) => only.includes(n.id)) : latestNodes.current;
    if (!el || !list.length) return;
    const minX = Math.min(...list.map((n) => n.x));
    const minY = Math.min(...list.map((n) => n.y));
    const maxX = Math.max(...list.map((n) => n.x + n.w));
    const maxY = Math.max(...list.map((n) => n.y + n.h));
    const pad = 48;
    // The zoom controls sit in the bottom-left corner: keep cards clear of them.
    const bottom = 72;
    const z = clampZoom(Math.min((el.clientWidth - pad * 2) / (maxX - minX), (el.clientHeight - pad - bottom) / (maxY - minY), 1));
    setViewport({ x: (el.clientWidth - (maxX - minX) * z) / 2 - minX * z, y: pad + (el.clientHeight - pad - bottom - (maxY - minY) * z) / 2 - minY * z, zoom: z });
  }, [setViewport]);

  useEffect(() => {
    if (fitRequest) fit();
  }, [fitRequest, fit]);

  // Runs after the commit that opened the strip, so the board has already shrunk.
  const focusKey = focus?.key;
  useEffect(() => {
    if (focus?.ids.length) fit(focus.ids);
    // Only when a new focus is asked for.
  }, [focusKey]);

  // The viewport is saved per canvas, not per screen: if a phone opens a canvas framed
  // on a desktop and no card is in view, or the saved zoom leaves the cards tiny (a
  // canvas last framed on a phone), frame them once.
  const framed = useRef(false);
  useEffect(() => {
    const el = surface.current;
    if (framed.current || !el || !nodes.length) return;
    framed.current = true;
    const inView = nodes.some((n) => {
      const left = n.x * zoom + x;
      const top = n.y * zoom + y;
      return left < el.clientWidth && left + n.w * zoom > 0 && top < el.clientHeight && top + n.h * zoom > 0 && left >= -n.w * zoom * 0.5 && left + n.w * zoom * 0.5 <= el.clientWidth;
    });
    if (!inView || zoom < 0.5) fit();
  }, [nodes, x, y, zoom, fit]);

  // Wheel needs a non-passive listener so the page doesn't scroll or zoom instead.
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
      else setViewport((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, setViewport]);

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return;
    gesture.current = { type: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, view: viewport };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) return startPinch();
    if (pointers.current.size > 2) return;
    const cardEl = (e.target as Element).closest<HTMLElement>("[data-card]");
    const node = cardEl ? nodes.find((n) => n.id === cardEl.dataset.card) : undefined;
    gesture.current = node
      ? { type: "card", id: node.id, sx: e.clientX, sy: e.clientY, cx: node.x, cy: node.y, moved: false, draggable: node.draggable }
      : { type: "pan", sx: e.clientX, sy: e.clientY, vx: x, vy: y, moved: false };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.type === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const z = clampZoom(g.view.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist));
      const wx = (g.mx - rect.left - g.view.x) / g.view.zoom;
      const wy = (g.my - rect.top - g.view.y) / g.view.zoom;
      const mx = (a.x + b.x) / 2 - rect.left;
      const my = (a.y + b.y) / 2 - rect.top;
      setViewport({ x: mx - wx * z, y: my - wy * z, zoom: z });
      return;
    }
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    g.moved = true;
    if (g.type === "pan") setViewport((v) => ({ ...v, x: g.vx + dx, y: g.vy + dy }));
    else if (g.draggable) onMove(g.id, g.cx + dx / zoom, g.cy + dy / zoom, false);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (g?.type === "pinch") {
      // Lifting one finger of a pinch ends it; the other finger doesn't start a pan.
      gesture.current = null;
      return;
    }
    gesture.current = null;
    if (!g || e.type === "pointercancel") return;
    if (g.type === "card") {
      if (g.moved && g.draggable) onMove(g.id, g.cx + (e.clientX - g.sx) / zoom, g.cy + (e.clientY - g.sy) / zoom, true);
      // A dropped card ends up selected too, so the arrow keys move the card you just moved.
      onSelect(g.id);
    } else if (!g.moved) {
      onSelect(null);
    }
  };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Zoomed far out, the dots would turn to noise: space them out in steps instead.
  let dots = DOT_GAP * zoom;
  while (dots < 12) dots *= 2;

  return (
    <div className="board-wrap">
      <div
        ref={surface}
        className="board"
        role="region"
        aria-label="Board. Drag to pan, scroll or pinch to zoom."
        style={{ backgroundSize: `${dots}px ${dots}px`, backgroundPosition: `${x}px ${y}px` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="board-world" style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})` }}>
          <svg className="board-edges" width="1" height="1" aria-hidden="true">
            {edges.map((edge) => {
              const a = byId.get(edge.from);
              const b = byId.get(edge.to);
              if (!a || !b) return null;
              const x1 = a.x + a.w;
              const y1 = a.y + a.h / 2;
              const x2 = b.x;
              const y2 = b.y + b.h / 2;
              const bend = Math.max(40, Math.abs(x2 - x1) / 2);
              return (
                <path
                  key={`${edge.from}-${edge.to}`}
                  className={`board-edge${edge.on ? " board-edge--on" : ""}${edge.story ? " board-edge--story" : ""}`}
                  d={`M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`}
                />
              );
            })}
          </svg>
          {nodes.map((n) => (
            <button
              key={n.id}
              type="button"
              data-card={n.id}
              className={`board-card${n.selected ? " board-card--on" : ""}${n.className ? ` ${n.className}` : ""}`}
              style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
              aria-label={n.label}
              aria-pressed={n.selected}
              // Pointer clicks are handled on pointer-up; this is for Enter and Space.
              onClick={(e) => {
                if (e.detail === 0) onSelect(n.id);
              }}
            >
              {n.content}
            </button>
          ))}
        </div>
      </div>

      <div className="board-zoom" role="group" aria-label="Zoom">
        <button type="button" aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.25)} disabled={zoom <= MIN_ZOOM}>−</button>
        <button type="button" aria-label="Zoom to 100%" className="board-zoom-value" onClick={() => zoomCenter(1 / zoom)}>{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label="Zoom in" onClick={() => zoomCenter(1.25)} disabled={zoom >= MAX_ZOOM}>+</button>
        <button type="button" onClick={() => fit()} disabled={!nodes.length}>Fit</button>
      </div>
    </div>
  );
}
