import type { GrayImage, Point } from './types';
import type { LineRef } from '../core/types';
import { crossing, type TableGeometry } from './mesh';

function bilerp(im: GrayImage, p: Point): number {
  const W = im.width, x = Math.max(0, Math.min(W - 1.001, p.x)), y = Math.max(0, Math.min(im.height - 1.001, p.y));
  const x0 = Math.floor(x), y0 = Math.floor(y), ax = x - x0, ay = y - y0, i = y0 * W + x0, d = im.data;
  return (1 - ay) * ((1 - ax) * d[i] + ax * d[i + 1]) + ay * ((1 - ax) * d[i + W] + ax * d[i + W + 1]);
}

// Photo point at continuous crossing coordinates (cx, cy): bilinear inside the cell's own 4 crossings.
function at(g: TableGeometry, cx: number, cy: number): Point {
  const c = Math.max(0, Math.min(g.cols - 1, Math.floor(cx))), r = Math.max(0, Math.min(g.rows - 1, Math.floor(cy)));
  const u = cx - c, v = cy - r;
  const a = crossing(g, c, r), b = crossing(g, c + 1, r), d = crossing(g, c, r + 1), e = crossing(g, c + 1, r + 1);
  return {
    x: (1 - v) * ((1 - u) * a.x + u * b.x) + v * ((1 - u) * d.x + u * e.x),
    y: (1 - v) * ((1 - u) * a.y + u * b.y) + v * ((1 - u) * d.y + u * e.y),
  };
}

function render(up: GrayImage, g: TableGeometry, w: number, h: number, map: (x: number, y: number) => [number, number]): GrayImage {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [cx, cy] = map(x + 0.5, y + 0.5);
    data[y * w + x] = Math.round(bilerp(up, at(g, cx, cy)));
  }
  return { width: w, height: h, data };
}

/** Rectified clue cells of one line: a horizontal strip (clue cells in reading order, left to right, each upright). */
export function cutStrip(upright: GrayImage, g: TableGeometry, line: LineRef, px: number): GrayImage {
  if (line.axis === 'row') {
    const r = g.colClueDepth + line.index;
    return render(upright, g, g.rowClueDepth * px, px, (x, y) => [x / px, r + y / px]);
  }
  const c = g.rowClueDepth + line.index;
  // column clue cells side by side, top cell first; each cell stays upright so its digits read normally
  return render(upright, g, g.colClueDepth * px, px, (x, y) => [c + (x % px) / px, Math.floor(x / px) + y / px]);
}

export const CELL_INSET = 0.15; // fraction of a cell skipped on each side (grid lines)

/** One px x px patch per grid cell, row-major over g.height x g.width, covering cell coords [INSET, 1-INSET]^2. */
export function cellPatches(upright: GrayImage, g: TableGeometry, px: number): GrayImage[] {
  const out: GrayImage[] = [], span = 1 - 2 * CELL_INSET;
  for (let r = 0; r < g.height; r++) for (let c = 0; c < g.width; c++) {
    const c0 = g.rowClueDepth + c + CELL_INSET, r0 = g.colClueDepth + r + CELL_INSET;
    out.push(render(upright, g, px, px, (x, y) => [c0 + (x / px) * span, r0 + (y / px) * span]));
  }
  return out;
}

/** Grid cell `cell` (row-major) plus half a cell of context on each side, 2px x 2px, for the review crop. */
export function cellView(upright: GrayImage, g: TableGeometry, cell: number, px: number): GrayImage {
  const c0 = g.rowClueDepth + (cell % g.width) - 0.5, r0 = g.colClueDepth + Math.floor(cell / g.width) - 0.5;
  return render(upright, g, 2 * px, 2 * px, (x, y) => [c0 + x / (2 * px) * 2, r0 + y / (2 * px) * 2]);
}

/** Full (no inset) px x px clue cells, upright: rows[i] = row i's cells left to right, cols[j] = column j's cells top to bottom. */
export function clueCells(upright: GrayImage, g: TableGeometry, px: number): { rows: GrayImage[][]; cols: GrayImage[][] } {
  const rows = Array.from({ length: g.height }, (_, i) => Array.from({ length: g.rowClueDepth }, (_, k) =>
    render(upright, g, px, px, (x, y) => [k + x / px, g.colClueDepth + i + y / px])));
  const cols = Array.from({ length: g.width }, (_, j) => Array.from({ length: g.colClueDepth }, (_, k) =>
    render(upright, g, px, px, (x, y) => [g.rowClueDepth + j + x / px, k + y / px])));
  return { rows, cols };
}

/** The corner area (crossings (0,0)..(rowClueDepth, colClueDepth)), rowClueDepth*pxPerCell x colClueDepth*pxPerCell. */
export function cornerBox(upright: GrayImage, g: TableGeometry, pxPerCell: number): GrayImage {
  return render(upright, g, g.rowClueDepth * pxPerCell, g.colClueDepth * pxPerCell, (x, y) => [x / pxPerCell, y / pxPerCell]);
}
