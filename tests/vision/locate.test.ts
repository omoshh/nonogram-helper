import { describe, it, expect } from 'vitest';
import { locateTable, type Located } from '../../src/vision/locate';
import type { GrayImage, Point } from '../../src/vision/types';
import { synthTable, type SynthOptions } from '../support/synthTable';
import { loadPhoto } from '../support/loadPhoto';
import { forEachPhoto } from './photos';

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function located(img: GrayImage): Located {
  const r = locateTable(img);
  if (!r.ok) throw new Error(`locateTable failed: ${r.reason}`);
  return r.value;
}

// True outer table corners TL,TR,BR,BL plus the local cell size at each.
function checkSynth(o: SynthOptions) {
  const { img, corners } = synthTable(o);
  const cols = o.rowClueDepth + o.width, last = corners.length - 1, nx = cols + 1;
  const idx = [0, cols, last, last - cols];
  const v = located(img);
  expect(v.rotation).toBe(o.rotation ?? 0);
  idx.forEach((k, n) => {
    const nb = n < 2 ? k + nx : k - nx; // vertical neighbour inside the table
    const cell = Math.min(dist(corners[k], corners[nb]), dist(corners[k], corners[n === 0 || n === 3 ? k + 1 : k - 1]));
    expect(dist(v.quad[n], corners[k]), `corner ${n}`).toBeLessThan(cell);
  });
  return v;
}

describe('locateTable (synthetic)', () => {
  for (const rotation of [0, 1, 2, 3] as const) {
    it(`25x35, depths 9/7, perspective 0.05, rotation ${rotation}`, () => {
      checkSynth({ width: 25, height: 35, colClueDepth: 9, rowClueDepth: 7, perspective: 0.05, rotation, seed: 11 + rotation, noise: 4 });
    }, 30_000);
  }

  it('ignores a finger blob at the image edge', () => {
    // seed 5: blob clear of the frame; seed 20: blob overlaps the bottom frame by ~1 cell
    for (const [rotation, seed] of [[0, 5], [3, 5], [2, 20]] as const)
      checkSynth({ width: 25, height: 35, colClueDepth: 9, rowClueDepth: 7, perspective: 0.05, rotation, seed, blobAtEdge: true });
  }, 30_000);

  it('blank white image -> no-table', () => {
    const img: GrayImage = { width: 800, height: 600, data: new Uint8Array(800 * 600).fill(255) };
    expect(locateTable(img)).toEqual({ ok: false, reason: 'no-table' });
  });

  it('a thick straight bar (degenerate quad) -> no-table, no throw', () => {
    const img: GrayImage = { width: 800, height: 600, data: new Uint8Array(800 * 600).fill(255) };
    for (let y = 290; y < 310; y++) for (let x = 50; x < 750; x++) img.data[y * 800 + x] = 0;
    expect(locateTable(img)).toEqual({ ok: false, reason: 'no-table' });
  });

  it('12 MP synthetic photo in under 2000 ms', () => {
    const v = checkSynth({ width: 25, height: 35, colClueDepth: 9, rowClueDepth: 7, cell: 80, perspective: 0.03, rotation: 1, seed: 2 });
    console.log(`12 MP synthetic: ${v.ms.toFixed(0)} ms`);
    expect(v.ms).toBeLessThan(2000);
  }, 120_000);
});

describe('locateTable (real photos)', () => {
  forEachPhoto((label) => {
    it(label.journal === 'main' ? 'rotation and BR corner match the label' : 'runs (other journal, not asserted)', () => {
      const img = loadPhoto(label.file)!; // decoded once per photo, outside the timed call
      const [tl, tr, br] = label.gridCorners.map(([x, y]) => ({ x, y }));
      const cell = dist(tl, tr) / label.width;
      const uw = label.rotation % 2 ? img.height : img.width, uh = label.rotation % 2 ? img.width : img.height;
      const r = locateTable(img);
      const err = r.ok ? dist(r.value.quad[2], br) / cell : NaN;
      console.log(`${label.file}: ${r.ok ? `rotation ${r.value.rotation} (label ${label.rotation}), BR err ${err.toFixed(2)} cells, ${r.value.ms.toFixed(0)} ms` : r.reason}`);
      if (label.journal === 'other') return;
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.rotation).toBe(label.rotation);
      expect(r.value.ms).toBeLessThan(2000);
      const inside = br.x >= 0 && br.y >= 0 && br.x < uw && br.y < uh;
      if (inside) expect(err).toBeLessThan(1);
    }, 120_000);
  });
});
