import type { GrayImage, Point } from './types';
import { downscale, rotatePoint } from './image';
import { adaptiveThreshold } from './binary';
import { homography, applyH } from './homography';

export interface Located { rotation: 0 | 1 | 2 | 3; quad: Point[] /* outer TABLE corners TL,TR,BR,BL in upright coords, full resolution */; ms: number }
export type LocateResult = { ok: true; value: Located } | { ok: false; reason: 'no-table' | 'no-corner-box' };

// 8-connected ink components: per-pixel labels (0 = none, id = index + 1) and pixel counts.
function components(mask: Uint8Array, w: number, h: number): { labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(w * h), sizes: number[] = [], stack = new Int32Array(w * h);
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || labels[s]) continue;
    const id = sizes.length + 1;
    let top = 0, n = 0;
    stack[top++] = s; labels[s] = id;
    while (top) {
      const i = stack[--top], x = i % w, y = (i - x) / w;
      n++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, j = ny * w + nx;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[j] && !labels[j]) { labels[j] = id; stack[top++] = j; }
      }
    }
    sizes.push(n);
  }
  return { labels, sizes };
}

export function locateTable(img: GrayImage): LocateResult {
  const t0 = performance.now();
  const f = Math.max(1, Math.round(Math.max(img.width, img.height) / 1000));
  const small = downscale(img, f), { width: w, height: h } = small;
  const mask = adaptiveThreshold(small, Math.round(Math.max(w, h) / 100), 10);
  const { labels, sizes } = components(mask, w, h);
  const best = sizes.reduce((b, n, i) => (n > sizes[b] ? i : b), 0); // the table's lines are one big component
  if (!sizes.length || sizes[best] < 0.01 * w * h) return { ok: false, reason: 'no-table' };

  // outer edge of the component per row / column; a straight frame side through each, robust to
  // foreign ink (fingers, stray strokes) glued to the table
  const id = best + 1, left = new Float64Array(h).fill(-1), right = new Float64Array(h).fill(-1);
  const top = new Float64Array(w).fill(-1), bottom = new Float64Array(w).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (labels[y * w + x] !== id) continue;
    if (left[y] < 0) left[y] = x;
    right[y] = x;
    if (top[x] < 0) top[x] = y;
    bottom[x] = y;
  }
  const tol = Math.max(2, Math.max(w, h) / 300);
  const [L, R, T, B] = [left, right, top, bottom].map((e) => fitSide(e, tol));
  // snap each corner to the outermost table pixel near it (the sides bow on a curved page)
  const r = Math.round(Math.max(w, h) / 50);
  const pts = [cross(L, T), cross(R, T), cross(R, B), cross(L, B)].map((p, k) => {
    const sx = k === 1 || k === 2 ? 1 : -1, sy = k >= 2 ? 1 : -1;
    let best = p, score = -Infinity;
    for (let y = Math.max(0, Math.round(p.y) - r); y <= Math.min(h - 1, Math.round(p.y) + r); y++)
      for (let x = Math.max(0, Math.round(p.x) - r); x <= Math.min(w - 1, Math.round(p.x) + r); x++)
        if (labels[y * w + x] === id && sx * x + sy * y > score) { score = sx * x + sy * y; best = { x, y }; }
    return best;
  });

  // a table fills a good part of the photo and is convex; this also keeps homography() off degenerate input
  const turns = pts.map((a, k) => {
    const b = pts[(k + 1) % 4], c = pts[(k + 2) % 4];
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  });
  if (turns.some((t) => t <= 0) || (turns[0] + turns[2]) / 2 < 0.05 * w * h) return { ok: false, reason: 'no-table' };

  // corner box: the table corner whose inside square has (almost) no lattice ink
  const H = homography([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], pts);
  const scores = [0, 1, 2, 3].map((k) => latticeScore(mask, w, h, H, k));
  const box = scores.indexOf(Math.min(...scores));
  const others = scores.filter((_, k) => k !== box);
  if (Math.min(...others) - scores[box] < 0.2) return { ok: false, reason: 'no-corner-box' }; // seen: box ≤ 0.63, lattice ≥ 0.74

  const rotation = ((4 - box) % 4) as 0 | 1 | 2 | 3;
  const quad = [0, 1, 2, 3].map((k) => {
    const p = pts[(box + k) % 4];
    return rotatePoint({ x: (p.x + 0.5) * f - 0.5, y: (p.y + 0.5) * f - 0.5 }, img.width, img.height, rotation);
  });
  return { ok: true, value: { rotation, quad, ms: performance.now() - t0 } };
}

// How strongly a straight lattice line crosses the small square just inside quad corner k: the best
// row (and column) ink coverage, ±2 px for tilt. Lattice ≈ 1 both ways; the corner box has only its label.
function latticeScore(mask: Uint8Array, w: number, h: number, H: Float64Array, k: number): number {
  const a = 0.025, b = 0.085;
  const map = (u: number, v: number) => applyH(H, { x: k === 1 || k === 2 ? 1 - u : u, y: k >= 2 ? 1 - v : v });
  const p0 = map(a, a), S = Math.max(16, Math.round(Math.min(dist(p0, map(b, a)), dist(p0, map(a, b)))));
  const g = new Uint8Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const p = map(a + ((b - a) * i) / (S - 1), a + ((b - a) * j) / (S - 1));
    const x = Math.round(p.x), y = Math.round(p.y);
    g[j * S + i] = x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0;
  }
  const best = (at: (line: number, along: number) => number) => {
    let m = 0;
    for (let l = 2; l < S - 2; l++) {
      let n = 0;
      for (let t = 0; t < S; t++) n += at(l - 2, t) | at(l - 1, t) | at(l, t) | at(l + 1, t) | at(l + 2, t);
      m = Math.max(m, n / S);
    }
    return m;
  };
  return Math.min(best((j, i) => g[j * S + i]), best((i, j) => g[j * S + i]));
}

type Line = [number, number]; // c = a * t + b

// RANSAC over point pairs, then least squares on the inliers. e[t] < 0 means no sample.
function fitSide(e: Float64Array, tol: number): Line {
  const ts: number[] = [];
  e.forEach((c, t) => { if (c >= 0) ts.push(t); });
  let seed = 12345, bestN = -1, best: Line = [0, 0];
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * ts.length | 0;
  const inliers = ([a, b]: Line) => ts.filter((t) => Math.abs(e[t] - a * t - b) <= tol);
  for (let k = 0; k < 300 && ts.length > 1; k++) {
    const p = ts[rnd()], q = ts[rnd()];
    if (Math.abs(p - q) < ts.length / 4) continue;
    const a = (e[q] - e[p]) / (q - p), n = inliers([a, e[p] - a * p]).length;
    if (n > bestN) { bestN = n; best = [a, e[p] - a * p]; }
  }
  const pts = inliers(best);
  const m = pts.length, st = pts.reduce((s, t) => s + t, 0), sc = pts.reduce((s, t) => s + e[t], 0);
  const stt = pts.reduce((s, t) => s + t * t, 0), stc = pts.reduce((s, t) => s + t * e[t], 0);
  const d = m * stt - st * st;
  if (m < 2 || d === 0) return best;
  const a = (m * stc - st * sc) / d;
  return [a, (sc - a * st) / m];
}

// Intersection of a vertical-ish side x = a*y + b with a horizontal-ish side y = c*x + d.
function cross([a, b]: Line, [c, d]: Line): Point {
  const x = (a * d + b) / (1 - a * c);
  return { x, y: c * x + d };
}

const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
