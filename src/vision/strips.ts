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

/** Rectified grid without clues, long side = maxSide. */
export function thumbnail(upright: GrayImage, g: TableGeometry, maxSide: number): GrayImage {
  const s = maxSide / Math.max(g.width, g.height);
  const w = Math.max(1, Math.round(g.width * s)), h = Math.max(1, Math.round(g.height * s));
  return render(upright, g, w, h, (x, y) => [g.rowClueDepth + (x / w) * g.width, g.colClueDepth + (y / h) * g.height]);
}
