import type { GrayImage, Point } from '../../src/vision/types';
import { rotate90 } from '../../src/vision/image';
import { homography, applyH, invertH } from '../../src/vision/homography';

export interface SynthOptions {
  width: number; height: number; colClueDepth: number; rowClueDepth: number;
  cell?: number; rotation?: 0 | 1 | 2 | 3; perspective?: number; bend?: number;
  noise?: number; blobAtEdge?: boolean; seed?: number;
}

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MARGIN = 3; // cells of white paper around the table

/**
 * Synthetic journal table with known geometry.
 * Table: (rowClueDepth + width) x (colClueDepth + height) cells; the top-left
 * rowClueDepth x colClueDepth corner box has no inner lines (maybe a label blob).
 * `corners`: every line crossing, row-major over (cols+1) x (rows+1), exact
 * (sub-pixel), in UPRIGHT coordinates. Crossings strictly inside the corner box
 * lie on no ink. `img` is the photo "as taken": `rotate90(img, rotation)`
 * restores the upright image in which `corners` are valid.
 */
export function synthTable(o: SynthOptions): { img: GrayImage; corners: Point[] } {
  const cell = o.cell ?? 24, rot = o.rotation ?? 0, rnd = mulberry32(o.seed ?? 1);
  const rd = o.rowClueDepth, cd = o.colClueDepth, C = rd + o.width, R = cd + o.height;
  const W = Math.round((C + 2 * MARGIN) * cell), Hh = Math.round((R + 2 * MARGIN) * cell);
  const s = cell / 24, thin = Math.max(0.6, 0.8 * s), thick = Math.max(1.1, 1.3 * s);

  // cell contents: blobs in clue cells and corner box, gray givens in the grid
  const kind = new Uint8Array(C * R);
  for (let j = 0; j < R; j++) for (let i = 0; i < C; i++) {
    const r = rnd();
    if (i < rd && j < cd) kind[j * C + i] = 0;
    else if (i < rd || j < cd) kind[j * C + i] = r < 0.4 ? 1 : 0;
    else kind[j * C + i] = r < 0.08 ? 2 : 0;
  }
  const label = { x: rd / 2, y: cd / 2 };

  const jit = (n: number) => (rnd() * 2 - 1) * (o.perspective ?? 0) * n;
  const quad = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: Hh }, { x: 0, y: Hh }]
    .map((p) => ({ x: p.x + jit(W), y: p.y + jit(Hh) }));
  const H = homography([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: Hh }, { x: 0, y: Hh }], quad);
  const Hi = invertH(H);
  const A = (o.bend ?? 0) * cell;
  const shift = (y: number) => A * Math.sin((Math.PI * y) / Hh); // x displacement depends on y: exact inverse

  const fwd = (u: number, v: number): Point => {
    const x = u * cell + MARGIN * cell, y = v * cell + MARGIN * cell;
    return applyH(H, { x: x + shift(y), y });
  };
  const corners: Point[] = [];
  for (let j = 0; j <= R; j++) for (let i = 0; i <= C; i++) corners.push(fwd(i, j));

  const lineW = (k: number, n: number, d: number) => (k === 0 || k === n || (((k - d) % 5) + 5) % 5 === 0 ? thick : thin);
  const cov = (dist: number, hw: number) => Math.min(1, Math.max(0, hw + 0.5 - Math.abs(dist)));

  const up: GrayImage = { width: W, height: Hh, data: new Uint8Array(W * Hh).fill(255) };
  for (let py = 0; py < Hh; py++) for (let px = 0; px < W; px++) {
    const b = applyH(Hi, { x: px, y: py });
    const y = b.y, x = b.x - shift(b.y);
    const u = (x - MARGIN * cell) / cell, v = (y - MARGIN * cell) / cell;
    if (u < -0.6 || v < -0.6 || u > C + 0.6 || v > R + 0.6) continue;
    let ink = 0, gray = 255;
    // vertical lines at integer u, horizontal at integer v
    const iu = Math.round(u), iv = Math.round(v);
    if (iu >= 0 && iu <= C && v >= -0.05 && v <= R + 0.05 && (iu === 0 || iu === C || iu >= rd || v > cd))
      ink = Math.max(ink, cov((u - iu) * cell, lineW(iu, C, rd) / 2));
    if (iv >= 0 && iv <= R && u >= -0.05 && u <= C + 0.05 && (iv === 0 || iv === R || iv >= cd || u > rd))
      ink = Math.max(ink, cov((v - iv) * cell, lineW(iv, R, cd) / 2));
    const ci = Math.floor(u), cj = Math.floor(v);
    if (ci >= 0 && ci < C && cj >= 0 && cj < R) {
      const k = kind[cj * C + ci];
      if (k === 1 && Math.hypot(u - ci - 0.5, v - cj - 0.5) < 0.2) ink = 1;
      if (k === 2 && u - ci > 0.1 && u - ci < 0.9 && v - cj > 0.1 && v - cj < 0.9) gray = 190;
    }
    if (Math.hypot(u - label.x, v - label.y) < 0.3 * Math.min(rd, cd)) ink = 1;
    up.data[py * W + px] = Math.min(gray, Math.round(255 - ink * 255));
  }

  if (o.blobAtEdge) { // finger: big dark ellipse centred on the bottom edge, clear of the table margin
    const cx = W * 0.7, rx = cell * 1.5, ry = cell * 2;
    for (let py = 0; py < Hh; py++) for (let px = 0; px < W; px++)
      if (((px - cx) / rx) ** 2 + ((py - Hh) / ry) ** 2 < 1) up.data[py * W + px] = 40;
  }

  const img = rotate90(up, ((4 - rot) % 4) as 0 | 1 | 2 | 3);
  if (o.noise) for (let k = 0; k < img.data.length; k++) {
    const g = (rnd() + rnd() + rnd() - 1.5) * 2 * o.noise;
    img.data[k] = Math.max(0, Math.min(255, Math.round(img.data[k] + g)));
  }
  return { img, corners };
}
