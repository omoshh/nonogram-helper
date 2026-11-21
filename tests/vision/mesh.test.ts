import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { detect, meshTable, meshFromCorners, crossing, type TableGeometry } from '../../src/vision/mesh';
import { rotate90 } from '../../src/vision/image';
import type { GrayImage, Point } from '../../src/vision/types';
import { synthTable, type SynthOptions } from '../support/synthTable';
import { loadPhoto } from '../support/loadPhoto';
import { PHOTOS } from './photos';

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function maxCrossingErr(g: TableGeometry, truth: Point[]): number {
  expect(g.xs.length).toBe(truth.length);
  let m = 0;
  truth.forEach((p, k) => { m = Math.max(m, Math.hypot(g.xs[k] - p.x, g.ys[k] - p.y)); });
  return m;
}

const SYNTH: SynthOptions[] = [
  { width: 25, height: 35, colClueDepth: 9, rowClueDepth: 7, perspective: 0.05, bend: 0.8, noise: 4, seed: 3 },
  { width: 50, height: 35, colClueDepth: 8, rowClueDepth: 9, perspective: 0.05, bend: 0.8, noise: 4, seed: 4, rotation: 3 },
];

describe('detect (synthetic, bent pages)', () => {
  for (const o of SYNTH) {
    it(`${o.width}x${o.height}, rotation ${o.rotation ?? 0}: size, depths, every crossing within 0.3 cell`, () => {
      const { img, corners } = synthTable(o);
      const r = detect(img);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const g = r.geometry;
      expect([g.rotation, g.width, g.height, g.colClueDepth, g.rowClueDepth])
        .toEqual([o.rotation ?? 0, o.width, o.height, o.colClueDepth, o.rowClueDepth]);
      expect([g.cols, g.rows]).toEqual([o.rowClueDepth + o.width, o.colClueDepth + o.height]);
      const err = maxCrossingErr(g, corners) / (o.cell ?? 24);
      console.log(`synth ${o.width}x${o.height}: max crossing err ${err.toFixed(3)} cells, confidence ${g.confidence.toFixed(3)}, ${r.ms.toFixed(0)} ms`);
      expect(err).toBeLessThan(0.3);
      expect(g.confidence).toBeGreaterThanOrEqual(0.9);
    }, 60_000);
  }

  it('meshFromCorners: grid corners off by 0.3 cell -> every crossing within 0.3 cell', () => {
    for (const o of SYNTH) {
      const { img, corners } = synthTable(o);
      const up = rotate90(img, o.rotation ?? 0);
      const rd = o.rowClueDepth, cd = o.colClueDepth, nx = rd + o.width + 1, cell = o.cell ?? 24;
      const at = (i: number, j: number) => corners[j * nx + i];
      const grid = [at(rd, cd), at(nx - 1, cd), at(nx - 1, cd + o.height), at(rd, cd + o.height)]
        .map((p, k) => ({ x: p.x + 0.3 * cell * Math.cos(1 + 2 * k), y: p.y + 0.3 * cell * Math.sin(1 + 2 * k) }));
      const g = meshFromCorners(up, grid, o);
      expect([g.width, g.height, g.colClueDepth, g.rowClueDepth]).toEqual([o.width, o.height, o.colClueDepth, o.rowClueDepth]);
      const err = maxCrossingErr(g, corners) / cell;
      console.log(`meshFromCorners ${o.width}x${o.height}: max crossing err ${err.toFixed(3)} cells`);
      expect(err).toBeLessThan(0.3);
      expect(g.confidence).toBeGreaterThanOrEqual(0.6); // no false warning
      expect(crossing(g, rd, cd)).toEqual({ x: g.xs[cd * nx + rd], y: g.ys[cd * nx + rd] });
    }
  }, 60_000);

  it('meshFromCorners: grid corners off by 0.7 cell -> within 0.3 cell or confidence below 0.6 (warning)', () => {
    const moves: [string, (k: number) => [number, number]][] = [
      ['spin', (k) => [Math.cos(1 + 2 * k), Math.sin(1 + 2 * k)]], ['right', () => [1, 0]], ['down', () => [0, 1]],
      ['diag', () => [Math.SQRT1_2, Math.SQRT1_2]], ['bottom-right only', (k) => (k === 2 ? [-Math.SQRT1_2, Math.SQRT1_2] : [0, 0])],
    ];
    for (const o of SYNTH) {
      const { img, corners } = synthTable(o);
      const up = rotate90(img, o.rotation ?? 0);
      const rd = o.rowClueDepth, cd = o.colClueDepth, nx = rd + o.width + 1, cell = o.cell ?? 24;
      const at = (i: number, j: number) => corners[j * nx + i];
      const grid = [at(rd, cd), at(nx - 1, cd), at(nx - 1, cd + o.height), at(rd, cd + o.height)];
      for (const [name, f] of moves) {
        const g = meshFromCorners(up, grid.map((p, k) => ({ x: p.x + 0.7 * cell * f(k)[0], y: p.y + 0.7 * cell * f(k)[1] })), o);
        const err = maxCrossingErr(g, corners) / cell;
        console.log(`meshFromCorners ${o.width}x${o.height} 0.7 cell ${name}: max crossing err ${err.toFixed(2)} cells, confidence ${g.confidence.toFixed(2)}`);
        expect(err < 0.3 || g.confidence < 0.6, name).toBe(true);
      }
    }
  }, 60_000);

  it('blank image -> clear failure, no throw', () => {
    const img: GrayImage = { width: 800, height: 600, data: new Uint8Array(800 * 600).fill(255) };
    const r = detect(img);
    expect(r.ok).toBe(false);
  });

  it('meshTable: a quad with NaN corners -> null, no throw', () => {
    const img: GrayImage = { width: 800, height: 600, data: new Uint8Array(800 * 600).fill(255) };
    expect(meshTable(img, [{ x: NaN, y: 0 }, { x: 700, y: 0 }, { x: 700, y: 500 }, { x: 0, y: 500 }])).toBeNull();
  });

  it('meshTable: a collinear (degenerate) quad -> null, no throw', () => {
    const { img } = synthTable({ width: 25, height: 30, colClueDepth: 5, rowClueDepth: 4, seed: 1 });
    expect(meshTable(img, [{ x: 10, y: 10 }, { x: 200, y: 200 }, { x: 400, y: 400 }, { x: 600, y: 600 }])).toBeNull();
    expect(meshTable(img, [{ x: 10, y: 10 }, { x: 10, y: 10 }, { x: 400, y: 400 }, { x: 10, y: 600 }])).toBeNull();
  });

  it('corner box that cannot be read (filled black) -> confidence halved below 0.5', () => {
    const o: SynthOptions = { width: 25, height: 35, colClueDepth: 9, rowClueDepth: 7, perspective: 0.03, noise: 4, seed: 9 };
    const { img, corners } = synthTable(o);
    const nx = o.rowClueDepth + o.width + 1, at = (i: number, j: number) => corners[j * nx + i];
    const [a, b] = [at(0, 0), at(o.rowClueDepth, o.colClueDepth)];
    for (let y = Math.round(a.y) - 2; y <= b.y + 2; y++) for (let x = Math.round(a.x) - 2; x <= b.x + 2; x++) img.data[y * img.width + x] = 20;
    const r = detect(img);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    console.log(`black box: depths ${r.geometry.colClueDepth},${r.geometry.rowClueDepth}, confidence ${r.geometry.confidence.toFixed(3)}`);
    expect(r.geometry.confidence).toBeLessThan(0.5);
  }, 60_000);

  it('stray stroke in the corner box misreads a depth into a known size -> confidence halved below 0.5', () => {
    // true 20x30 with row clue depth 6; a stroke on line 1 in the top box row reads as depth 1 -> 25x30 (known)
    const o: SynthOptions = { width: 20, height: 30, colClueDepth: 5, rowClueDepth: 6, perspective: 0.03, noise: 4, seed: 9 };
    const { img, corners } = synthTable(o);
    const nx = o.rowClueDepth + o.width + 1, [p, q] = [corners[1], corners[nx + 1]];
    for (let y = Math.round(p.y); y <= q.y; y++) for (let d = -1; d <= 1; d++) img.data[y * img.width + Math.round(p.x + ((q.x - p.x) * (y - p.y)) / (q.y - p.y)) + d] = 0;
    const r = detect(img);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    console.log(`stray stroke: ${r.geometry.width}x${r.geometry.height}, depths ${r.geometry.colClueDepth},${r.geometry.rowClueDepth}, confidence ${r.geometry.confidence.toFixed(3)}`);
    expect(r.geometry.confidence).toBeLessThan(0.5);
  }, 60_000);

  it('unknown sizes: 24x35 snaps to 25x35, 40x50 is kept; both with lowered confidence', () => {
    for (const [w, h, ew, eh] of [[24, 35, 25, 35], [40, 50, 40, 50]]) {
      const { img } = synthTable({ width: w, height: h, colClueDepth: 6, rowClueDepth: 5, perspective: 0.03, noise: 4, seed: 7 });
      const r = detect(img);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect([r.geometry.width, r.geometry.height, r.geometry.colClueDepth, r.geometry.rowClueDepth]).toEqual([ew, eh, 6, 5]);
      expect(r.geometry.xs.length).toBe((ew + 6) * (eh + 7));
      expect(r.geometry.confidence).toBeLessThan(0.5);
    }
  }, 60_000);

  it('12 MP synthetic photo in under 2000 ms', () => {
    const o: SynthOptions = { width: 25, height: 35, colClueDepth: 9, rowClueDepth: 7, cell: 80, perspective: 0.03, rotation: 1, seed: 2 };
    const { img } = synthTable(o);
    const r = detect(img);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    console.log(`12 MP synthetic detect: ${r.ms.toFixed(0)} ms`);
    expect([r.geometry.width, r.geometry.height]).toEqual([25, 35]);
    expect(r.ms).toBeLessThan(2000);
  }, 120_000);
});

const present = PHOTOS.filter((p) => existsSync(p.file));

describe.skipIf(!present.length)('detect (real photos)', () => {
  it('main journal: size, depths, rotation and grid corners match the label on at least 28 of 29', () => {
    const rows: string[] = [];
    let pass = 0, main = 0;
    for (const label of present) {
      const img = loadPhoto(label.file)!; // decoded outside the timed call
      const r = detect(img);
      const uw = label.rotation % 2 ? img.height : img.width, uh = label.rotation % 2 ? img.width : img.height;
      const lc = label.gridCorners.map(([x, y]) => ({ x, y }));
      const cell = dist(lc[0], lc[1]) / label.width;
      let ok = false, line = `${label.file}: `;
      if (!r.ok) line += `FAIL ${r.reason}`;
      else {
        const g = r.geometry;
        const mine = [crossing(g, g.rowClueDepth, g.colClueDepth), crossing(g, g.cols, g.colClueDepth),
          crossing(g, g.cols, g.rows), crossing(g, g.rowClueDepth, g.rows)];
        const err = Math.max(...lc.map((p, k) => (p.x >= 0 && p.y >= 0 && p.x < uw && p.y < uh ? dist(p, mine[k]) / cell : 0)));
        const same = g.rotation === label.rotation && g.width === label.width && g.height === label.height
          && g.colClueDepth === label.colClueDepth && g.rowClueDepth === label.rowClueDepth;
        ok = same && err < 0.5 && r.ms < 2000;
        line += `rot ${g.rotation}/${label.rotation} size ${g.width}x${g.height}/${label.width}x${label.height} `
          + `depths ${g.colClueDepth},${g.rowClueDepth}/${label.colClueDepth},${label.rowClueDepth} `
          + `corner err ${err.toFixed(2)} conf ${g.confidence.toFixed(2)} ${r.ms.toFixed(0)} ms`;
      }
      if (label.journal === 'main') { main++; if (ok) pass++; line += ok ? ' PASS' : ' MISS'; }
      else line += ' (other journal, not asserted)';
      if (r.ok) expect(r.ms, label.file).toBeLessThan(2000);
      rows.push(line);
    }
    console.log(rows.join('\n') + `\nmain journal: ${pass}/${main} pass`);
    if (present.length === PHOTOS.length) expect(main).toBe(29);
    expect(pass).toBeGreaterThanOrEqual(main - 1);
  }, 600_000);

  const j37 = 'empty/PXL_20261119_101316578.MP.jpg';
  it.skipIf(!existsSync(j37))('j37: given cells are darker than the median cell (interior mesh)', () => {
    const fx = JSON.parse(readFileSync(new URL('../fixtures/puzzles/j37-25x35.json', import.meta.url), 'utf8'));
    expect(fx.source).toBe(j37);
    const photo = loadPhoto(j37)!;
    const r = detect(photo);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const g = r.geometry, up = rotate90(photo, g.rotation);
    expect([g.width, g.height]).toEqual([fx.width, fx.height]);
    // mean gray over the inner 50% of grid cell (c, r), bilinear between its 4 crossings
    const cellGray = (c: number, rr: number) => {
      const i = g.rowClueDepth + c, j = g.colClueDepth + rr;
      const [a, b, d, e] = [crossing(g, i, j), crossing(g, i + 1, j), crossing(g, i + 1, j + 1), crossing(g, i, j + 1)];
      let s = 0, n = 0;
      for (let v = 0.25; v <= 0.75; v += 0.05) for (let u = 0.25; u <= 0.75; u += 0.05) {
        const x = (1 - v) * ((1 - u) * a.x + u * b.x) + v * ((1 - u) * e.x + u * d.x);
        const y = (1 - v) * ((1 - u) * a.y + u * b.y) + v * ((1 - u) * e.y + u * d.y);
        s += up.data[Math.round(y) * up.width + Math.round(x)]; n++;
      }
      return s / n;
    };
    const all: number[] = [];
    for (let rr = 0; rr < g.height; rr++) for (let c = 0; c < g.width; c++) all.push(cellGray(c, rr));
    const median = [...all].sort((p, q) => p - q)[all.length >> 1];
    const givens: number[] = fx.givens.map((k: number) => all[k]);
    const mean = givens.reduce((p, q) => p + q, 0) / givens.length;
    console.log(`j37: givens mean ${mean.toFixed(1)}, all-cell median ${median.toFixed(1)}, darkest given ${Math.min(...givens).toFixed(1)}, lightest given ${Math.max(...givens).toFixed(1)}`);
    expect(givens).toHaveLength(25);
    expect(median - mean).toBeGreaterThanOrEqual(25);
  }, 120_000);
});
