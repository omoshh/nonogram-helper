import { describe, it, expect } from 'vitest';
import { cutStrip, thumbnail } from '../../src/vision/strips';
import type { TableGeometry } from '../../src/vision/mesh';
import type { GrayImage } from '../../src/vision/types';
import { synthTable } from '../support/synthTable';

const o = { width: 12, height: 10, colClueDepth: 4, rowClueDepth: 5, perspective: 0.04, bend: 0.5, seed: 7 };
const { img, corners } = synthTable(o);
const g: TableGeometry = {
  rotation: 0, width: o.width, height: o.height, colClueDepth: o.colClueDepth, rowClueDepth: o.rowClueDepth,
  cols: o.rowClueDepth + o.width, rows: o.colClueDepth + o.height,
  xs: Float32Array.from(corners, (p) => p.x), ys: Float32Array.from(corners, (p) => p.y), confidence: 1,
};
const px = 20;
const at = (im: GrayImage, x: number, y: number) => im.data[Math.round(y) * im.width + Math.round(x)];
// ink at the centre of a clue cell in the source photo (centres hold no lines, only blobs)
const ink = (c: number, r: number) => {
  const p = [0, 1].flatMap((dy) => [0, 1].map((dx) => corners[(r + dy) * (g.cols + 1) + c + dx]));
  return at(img, p.reduce((s, q) => s + q.x, 0) / 4, p.reduce((s, q) => s + q.y, 0) / 4) < 128;
};

describe('cutStrip', () => {
  it('row strip: size and dark centres exactly where blobs are', () => {
    const r = Array.from({ length: o.height }, (_, k) => k).find((k) => { const w = Array.from({ length: o.rowClueDepth }, (_, i) => ink(i, o.colClueDepth + k)); return w.some(Boolean) && !w.every(Boolean); })!;
    const s = cutStrip(img, g, { axis: 'row', index: r }, px);
    expect([s.width, s.height]).toEqual([o.rowClueDepth * px, px]);
    const want = Array.from({ length: o.rowClueDepth }, (_, i) => ink(i, o.colClueDepth + r));
    const got = want.map((_, i) => at(s, i * px + px / 2, px / 2) < 128);
    expect(got).toEqual(want);
  });
  it('col strip: horizontal, first clue cell (top) at the left', () => {
    const c = Array.from({ length: o.width }, (_, k) => k).find((k) => { const w = Array.from({ length: o.colClueDepth }, (_, j) => ink(o.rowClueDepth + k, j)); return w.some(Boolean) && !w.every(Boolean); })!;
    const s = cutStrip(img, g, { axis: 'col', index: c }, px);
    expect([s.width, s.height]).toEqual([o.colClueDepth * px, px]);
    const want = Array.from({ length: o.colClueDepth }, (_, j) => ink(o.rowClueDepth + c, j));
    expect(want.map((_, j) => at(s, j * px + px / 2, px / 2) < 128)).toEqual(want);
  });
  it('col strip: every cell upright (a dot right of each cell centre stays right of it)', () => {
    const marked = { ...img, data: img.data.slice() }, c = 3, ci = o.rowClueDepth + c;
    for (let j = 0; j < o.colClueDepth; j++) { // 5x5 px dot at cell point (0.8, 0.5), bilinear in the cell's crossings
      const q = (u: number, v: number) => [0, 1].flatMap((dy) => [0, 1].map((dx) => corners[(j + dy) * (g.cols + 1) + ci + dx]))
        .reduce((s, p, k) => { const w = (k & 1 ? u : 1 - u) * (k & 2 ? v : 1 - v); return { x: s.x + w * p.x, y: s.y + w * p.y }; }, { x: 0, y: 0 });
      const d = q(0.8, 0.5);
      for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) marked.data[(Math.round(d.y) + y) * img.width + Math.round(d.x) + x] = 0;
    }
    const s = cutStrip(marked, g, { axis: 'col', index: c }, px);
    for (let j = 0; j < o.colClueDepth; j++) {
      expect(at(s, j * px + 0.8 * px, px / 2), `cell ${j} right`).toBeLessThan(128);
      expect(at(s, j * px + 0.2 * px, px / 2), `cell ${j} left`).toBeGreaterThan(128);
      expect(at(s, j * px + px / 2, 0.2 * px), `cell ${j} top`).toBeGreaterThan(128);
    }
  });
});

describe('thumbnail', () => {
  it('long side is maxSide', () => {
    const t = thumbnail(img, g, 120);
    expect(Math.max(t.width, t.height)).toBe(120);
    expect(t.width).toBeGreaterThan(t.height); // 12 x 10 grid
  });
});
