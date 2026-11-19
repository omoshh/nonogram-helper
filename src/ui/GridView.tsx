import { FILLED, EMPTY } from '../core/types';

export function GridView(props: {
  width: number; height: number; cells: Uint8Array;
  rows?: number[][]; cols?: number[][];
  marked?: Set<number>; markColor?: string;
  onTap?: (cell: number) => void;
}) {
  const { width, height, cells, rows, cols, marked, markColor, onTap } = props;
  const withClues = !!(rows && cols);
  // Fit about 360px of cells on a phone; the box scrolls when wider.
  // Tappable grids keep cells finger-sized (28px) and scroll instead.
  const cell = Math.max(onTap ? 28 : 10, Math.min(32, Math.floor(360 / width)));

  const tap = (e: MouseEvent) => {
    const i = (e.target as HTMLElement).dataset.cell;
    if (onTap && i !== undefined) onTap(Number(i));
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
      if (c % 5 === 4 && c < width - 1) cls += ' edge-right';
      if (r % 5 === 4 && r < height - 1) cls += ' edge-bottom';
      const isMarked = marked?.has(i);
      if (isMarked) cls += ' marked';
      items.push(
        <div
          key={i}
          class={cls}
          data-cell={i}
          style={isMarked && markColor ? { outlineColor: markColor } : undefined}
        />,
      );
    }
  }

  return (
    <div class="grid-scroll">
      <div
        class={`grid${onTap ? ' tappable' : ''}`}
        style={{
          '--cell': `${cell}px`,
          gridTemplateColumns: `${withClues ? 'auto ' : ''}repeat(${width}, var(--cell))`,
        }}
        onClick={tap}
      >
        {items}
      </div>
    </div>
  );
}
