import { useEffect, useRef, useState, type ReactNode } from "react";

const MIN_COLUMN_WIDTH = 320; // about the size of a Higgsfield tile
const GAP = 8;
const PHONE_WIDTH = 560; // below this, tiles stay in two columns instead of one huge one

const columnsFor = (width: number) => (width < PHONE_WIDTH ? 2 : Math.max(2, Math.floor((width + GAP) / (MIN_COLUMN_WIDTH + GAP))));

type Props<T> = {
  items: T[];
  itemKey: (item: T) => string;
  /** "width:height" */
  ratio: (item: T) => string;
  renderItem: (item: T) => ReactNode;
};

/**
 * Staggered tiles of different heights. Each item goes in the currently shortest column,
 * so the order still reads left to right and the columns end up about the same length.
 * Heights come from the known ratios, so tiles don't jump around as videos load.
 */
export default function Masonry<T>({ items, itemKey, ratio, renderItem }: Props<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(4);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setCount(columnsFor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columns: T[][] = Array.from({ length: count }, () => []);
  const heights = new Array<number>(count).fill(0);
  for (const item of items) {
    const shortest = heights.indexOf(Math.min(...heights));
    const [w = 9, h = 16] = ratio(item).split(":").map(Number);
    columns[shortest]!.push(item);
    heights[shortest]! += h / w;
  }

  return (
    <div className="masonry" ref={ref}>
      {columns.map((column, i) => (
        <div className="masonry-column" key={i}>
          {column.map((item) => <div key={itemKey(item)}>{renderItem(item)}</div>)}
        </div>
      ))}
    </div>
  );
}
