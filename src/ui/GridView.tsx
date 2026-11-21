import { useEffect, useRef, useState } from 'preact/hooks';
import { FILLED, EMPTY } from '../core/types';

/** Short enough to feel instant, long enough for a second tap. */
const DOUBLE_TAP_MS = 250;
/** px between cells; every 5th line adds BLOCK_GAP more, so 5×5 blocks stand out (keep in step with style.css). */
const GAP = 1, BLOCK_GAP = 2;
/** Track sizes: every 5th track (not the last) is BLOCK_GAP wider; the cell keeps --cell and the rest is gap. */
const tracks = (n: number) => Array.from({ length: n }, (_, i) =>
  (i % 5 === 4 && i < n - 1 ? `calc(var(--cell) + ${BLOCK_GAP}px)` : 'var(--cell)')).join(' ');

export function GridView(props: {
  width: number; height: number; cells: Uint8Array;
  rows?: number[][]; cols?: number[][];
  marked?: Set<number>;
  /** How marked cells are drawn: a mistake (fill and ×) or a hint (outline). */
  markKind?: 'mistake' | 'hint';
  /** Hint answers drawn inside the outline: FILLED or EMPTY per cell. */
  markValues?: Map<number, number>;
  /** Cells printed filled in the puzzle: drawn apart from the user's marks. */
  givens?: Set<number>;
  onTap?: (cell: number) => void;
  /** Cells drawn with a ring (to look at again). */
  ringed?: Set<number>;
  /** Zoom in and scroll this cell to the centre. */
  focus?: number;
}) {
  const { width, height, cells, rows, cols, marked, markKind = 'mistake', markValues, givens, onTap, ringed, focus } = props;
  const [zoomed, setZoomed] = useState(focus !== undefined);
  const box = useRef<HTMLDivElement>(null);
  // A real tap (click detail >= 1) waits DOUBLE_TAP_MS so a double-tap can cancel it; detail 0 (keyboard) applies at once.
  const pending = useRef<{ cell: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const flush = () => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    onTapRef.current?.(p.cell);
  };
  useEffect(() => flush, []); // leaving applies a waiting tap instead of dropping it
  const withClues = !!(rows && cols);
  // Tappable grids start fitted to the box width (cells may be small) and zoom to 28px cells that scroll.
  // Other grids: about 360px of cells, scrolling when wider.
  // shortcut: clue columns estimated at 2 chars per cell; box width read at render, not on resize.
  const clueCols = withClues ? Math.max(1, Math.ceil(Math.max(0, ...rows!.map((r) => r.join(' ').length)) / 2)) : 0;
  const boxWidth = box.current?.clientWidth || window.innerWidth - 32;
  // Room taken by the gaps: GAP between all columns, BLOCK_GAP extra after every 5th.
  const gaps = (width - 1 + (withClues ? 1 : 0)) * GAP + Math.floor((width - 1) / 5) * BLOCK_GAP;
  const cell = onTap
    ? (zoomed ? 28 : Math.max(1, Math.floor((boxWidth - gaps) / (width + clueCols))))
    : Math.max(10, Math.min(32, Math.floor(360 / width)));

  useEffect(() => { if (focus !== undefined) setZoomed(true); }, [focus]);
  useEffect(() => {
    if (zoomed && focus !== undefined) {
      box.current?.querySelector(`[data-cell="${focus}"]`)?.scrollIntoView?.({ block: 'center', inline: 'center' });
    }
  }, [focus, zoomed]);

  const tap = (e: MouseEvent) => {
    const i = (e.target as HTMLElement).dataset.cell;
    if (!onTap || i === undefined) return;
    const cell = Number(i);
    // Second click on the same cell cancels its waiting tap and toggles zoom; a different cell's tap applies the waiting one first.
    if (pending.current?.cell === cell && e.detail === 2) {
      clearTimeout(pending.current.timer);
      pending.current = null;
      setZoomed((z) => !z);
      return;
    }
    flush();
    if (e.detail === 0) onTap(cell);
    else pending.current = { cell, timer: setTimeout(flush, DOUBLE_TAP_MS) };
  };

  const items = [];
  if (withClues) {
    items.push(<div key="corner" />);
    for (let c = 0; c < width; c++) {
      items.push(
        <div key={`c${c}`} class="grid-clue col-clue">
          {cols![c].map((n, k) => <span key={k}>{n}</span>)}
        </div>,
      );
    }
  }
  for (let r = 0; r < height; r++) {
    if (withClues) items.push(<div key={`r${r}`} class="grid-clue row-clue">{rows![r].join(' ')}</div>);
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      const v = cells[i];
      let cls = 'grid-cell';
      if (v === FILLED) cls += ' filled';
      else if (v === EMPTY) cls += ' empty';
      if (givens?.has(i)) cls += ' given';
      if (c % 5 === 4 && c < width - 1) cls += ' block-right';
      if (r % 5 === 4 && r < height - 1) cls += ' block-bottom';
      if (marked?.has(i)) {
        cls += ` marked ${markKind}`;
        const answer = markValues?.get(i);
        if (answer === FILLED) cls += ' answer-filled';
        else if (answer === EMPTY) cls += ' answer-empty';
      }
      if (ringed?.has(i)) cls += ' ring';
      items.push(
        <div key={i} class={cls} data-cell={i} />,
      );
    }
  }

  return (
    <>
    {onTap && <button type="button" class="zoom-toggle" aria-pressed={zoomed} onClick={() => setZoomed(!zoomed)}>Zoom</button>}
    <div class="grid-scroll" ref={box}>
      <div
        class={`grid${onTap ? ' tappable' : ''}`}
        style={{
          '--cell': `${cell}px`,
          gap: `${GAP}px`,
          gridTemplateColumns: `${withClues ? 'auto ' : ''}${tracks(width)}`,
          gridTemplateRows: `${withClues ? 'auto ' : ''}${tracks(height)}`,
        }}
        onClick={tap}
      >
        {items}
      </div>
    </div>
    </>
  );
}
