import type { GrayImage, Point } from './types';
import { rotate90 } from './image';
import { homography, applyH, type H } from './homography';
import { locateTable } from './locate';
import { KNOWN_SIZES } from '../core/clues';

export interface TableSize { width: number; height: number; colClueDepth: number; rowClueDepth: number }

export interface TableGeometry {
  rotation: 0 | 1 | 2 | 3;
  width: number; height: number;              // grid
  colClueDepth: number; rowClueDepth: number;
  cols: number; rows: number;                 // rowClueDepth + width, colClueDepth + height
  xs: Float32Array; ys: Float32Array;         // (cols+1)*(rows+1) crossings, row-major, upright full-res coords
  confidence: number;                         // 0..1, fraction of crossings found by tracking (rest interpolated)
}

const RECT_LONG = 1800; // long side of the rectified table, px
const MIN_COV = 0.5;    // a line covers at least this fraction of a band
const WIN = 0.3;        // tracking search window, cells

export function crossing(g: TableGeometry, col: number, row: number): Point {
  const k = row * (g.cols + 1) + col;
  return { x: g.xs[k], y: g.ys[k] };
}

/**
 * The table quad warped to an axis-aligned image ("rect") with a margin M around it, reduced to two
 * ridge masks: vertical line ink (row-major) and horizontal line ink stored transposed, so both line
 * families are handled by the same code as "vertical lines" (Fam).
 */
interface Rect { w: number; h: number; M: number; tw: number; th: number; toUp: H; v: Uint8Array; hT: Uint8Array; px: number; py: number }

function rectify(up: GrayImage, quad: Point[]): Rect {
  const d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const qw = (d(quad[0], quad[1]) + d(quad[3], quad[2])) / 2, qh = (d(quad[0], quad[3]) + d(quad[1], quad[2])) / 2;
  const s = Math.min(1, RECT_LONG / Math.max(qw, qh));
  const tw = Math.round(qw * s), th = Math.round(qh * s), M = Math.round(0.05 * Math.max(tw, th));
  const w = tw + 2 * M, h = th + 2 * M;
  const toUp = homography([{ x: M, y: M }, { x: M + tw, y: M }, { x: M + tw, y: M + th }, { x: M, y: M + th }], quad);
  const g = new Uint8Array(w * h), W = up.width, Hh = up.height, src = up.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const q = toUp[6] * x + toUp[7] * y + toUp[8];
    const fx = (toUp[0] * x + toUp[1] * y + toUp[2]) / q, fy = (toUp[3] * x + toUp[4] * y + toUp[5]) / q;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= Hh - 1) { g[y * w + x] = 255; continue; }
    const ax = fx - x0, ay = fy - y0, i = y0 * W + x0;
    g[y * w + x] = (1 - ay) * ((1 - ax) * src[i] + ax * src[i + 1]) + ay * ((1 - ax) * src[i + W] + ax * src[i + W + 1]);
  }
  // ridge masks: darker than both neighbours r px away across the line (flat shading and edges drop out)
  const r = 3, T = 12;
  const v = new Uint8Array(w * h), hT = new Uint8Array(w * h);
  for (let y = r; y < h - r; y++) for (let x = r; x < w - r; x++) {
    const i = y * w + x, c = g[i] + T;
    if (c < g[i - r] && c < g[i + r]) v[i] = 1;
    if (c < g[i - r * w] && c < g[i + r * w]) hT[x * h + y] = 1;
  }
  // cell pitch along x and y from line ink near the far table sides (all lines are present there)
  const colP = new Float64Array(w), rowP = new Float64Array(h);
  for (let y = M + Math.round(0.85 * th); y < M + th; y++) for (let x = 0; x < w; x++) colP[x] += v[y * w + x];
  for (let x = M + Math.round(0.85 * tw); x < M + tw; x++) for (let y = 0; y < h; y++) rowP[y] += hT[x * h + y];
  return { w, h, M, tw, th, toUp, v, hT, px: pitch(colP, tw), py: pitch(rowP, th) };
}

// Dominant period of a profile: autocorrelation peak, preferring a sub-harmonic when it is nearly as strong.
function pitch(p: Float64Array, span: number): number {
  const n = p.length, mean = p.reduce((a, b) => a + b, 0) / n;
  const q = Array.from(p, (v) => v - mean);
  const lo = Math.max(6, Math.floor(span / 90)), hi = Math.ceil(span / 12);
  const A = new Float64Array(hi + 2);
  for (let L = lo - 1; L <= hi + 1; L++) { let s = 0; for (let i = 0; i + L < n; i++) s += q[i] * q[i + L]; A[L] = s / (n - L); }
  let L = lo;
  for (let k = lo; k <= hi; k++) if (A[k] > A[L]) L = k;
  for (const div of [2, 3]) {
    let b = -1;
    for (let k = Math.max(lo, Math.floor((L / div) * 0.85)); k <= Math.ceil((L / div) * 1.15); k++) if (b < 0 || A[k] > A[b]) b = k;
    if (b > lo && A[b] >= A[b - 1] && A[b] >= A[b + 1] && A[b] > 0.6 * A[L]) { L = b; break; }
  }
  const a = A[L - 1], b = A[L], c = A[L + 1], den = a - 2 * b + c;
  return den < 0 ? L + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : L;
}

/**
 * One family of lines, seen as "vertical" lines in mask m (w across × h along), in bands of bh rows.
 * X[k * nb + b] = x of line k at the centre of band b, F = 1 where it was measured (not interpolated).
 */
interface Fam {
  m: Uint8Array; w: number; h: number; p: number; bh: number; nb: number; b0: number;
  seeds: number[]; X: Float64Array; F: Uint8Array; forbid: (k: number, b: number) => boolean;
}

function family(m: Uint8Array, w: number, h: number, p: number, bh: number, b0At: number): Fam {
  bh = Math.max(4, Math.round(bh));
  const nb = Math.ceil(h / bh), b0 = Math.max(0, Math.min(nb - 1, Math.floor(b0At / bh)));
  return { m, w, h, p, bh, nb, b0, seeds: [], X: new Float64Array(0), F: new Uint8Array(0), forbid: () => false };
}

// Line coverage of band b for x in [lo - 1, hi + 1], sampled along slope dx/dy (lines bend on curved pages):
// the fraction of band rows with ink within ±1 px.
function cover(f: Fam, b: number, lo: number, hi: number, slope: number): Float32Array {
  const cov = new Float32Array(hi - lo + 3), y0 = b * f.bh, y1 = Math.min(f.h, y0 + f.bh), yc = (y0 + y1 - 1) / 2, m = f.m;
  for (let y = y0; y < y1; y++) {
    const s = lo - 1 + Math.round(slope * (y - yc)), row = y * f.w;
    for (let d = 0; d < cov.length; d++) {
      const x = s + d;
      if (x >= 1 && x < f.w - 1 && (m[row + x - 1] | m[row + x] | m[row + x + 1])) cov[d]++;
    }
  }
  for (let d = 0; d < cov.length; d++) cov[d] /= y1 - y0;
  return cov;
}

// Best peak of band b within [c - r, c + r] along slope: sub-pixel position and coverage.
function peak(f: Fam, b: number, c: number, r: number, slope: number): [number, number] {
  const lo = Math.round(c - r), cov = cover(f, b, lo, Math.round(c + r), slope);
  let bi = 1;
  for (let i = 2; i < cov.length - 1; i++) if (cov[i] > cov[bi]) bi = i;
  const a = cov[bi - 1], v = cov[bi], d = cov[bi + 1], den = a - 2 * v + d;
  return [lo - 1 + bi + (den < 0 ? (0.5 * (a - d)) / den : 0), v];
}

/**
 * Track f.seeds (positions at band b0) outward band by band: search near the prediction (last position
 * + slope); a line not found there moves like its found neighbours (interpolated by index), so curves
 * are followed through shading, the corner box and parts outside the photo.
 */
function track(f: Fam): void {
  const n = f.seeds.length, { nb } = f, win = WIN * f.p;
  const X = (f.X = new Float64Array(n * nb)), F = (f.F = new Uint8Array(n * nb));
  // band b from the previous positions: measured near prev + v; lines not found move like their found
  // neighbours (displacement interpolated by line index)
  const step = (b: number, prev: ArrayLike<number>, v: ArrayLike<number>, slope: number) => {
    const disp = new Float64Array(n).fill(NaN);
    for (let k = 0; k < n; k++) {
      if (f.forbid(k, b)) continue;
      const [x, c] = peak(f, b, prev[k] + v[k], win, slope * v[k]);
      if (c >= MIN_COV) disp[k] = x - prev[k];
    }
    for (let k = 0, l = -1; k < n; k++) { // two lines on one peak: keep the one nearer its prediction
      if (Number.isNaN(disp[k])) continue;
      if (l >= 0 && prev[k] + disp[k] - prev[l] - disp[l] < 0.5 * f.p) {
        if (Math.abs(disp[k] - v[k]) > Math.abs(disp[l] - v[l])) { disp[k] = NaN; continue; }
        disp[l] = NaN;
      }
      l = k;
    }
    for (let k = 0; k < n; k++) {
      let d = disp[k];
      if (Number.isNaN(d)) {
        let l = k - 1, r = k + 1;
        while (l >= 0 && Number.isNaN(disp[l])) l--;
        while (r < n && Number.isNaN(disp[r])) r++;
        d = l >= 0 && r < n ? disp[l] + ((disp[r] - disp[l]) * (k - l)) / (r - l) : l >= 0 ? disp[l] : r < n ? disp[r] : v[k];
      } else F[k * nb + b] = 1;
      X[k * nb + b] = prev[k] + d;
    }
  };
  step(f.b0, f.seeds, new Float64Array(n), 0);
  for (const dir of [-1, 1]) {
    const v = new Float64Array(n);
    for (let b = f.b0 + dir; b >= 0 && b < nb; b += dir) {
      const prev = Array.from({ length: n }, (_, k) => X[k * nb + b - dir]);
      step(b, prev, v, dir / f.bh);
      for (let k = 0; k < n; k++) v[k] = Math.max(-win, Math.min(win, X[k * nb + b] - prev[k]));
    }
  }
}

// x of line k at coordinate y along the line (piecewise linear between band centres)
function at(f: Fam, k: number, y: number): number {
  if (f.nb < 2) return f.X[k * f.nb];
  const t = Math.max(0, Math.min(f.nb - 1, y / f.bh - 0.5)), b = Math.min(f.nb - 2, Math.floor(t)), a = t - b;
  return f.X[k * f.nb + b] * (1 - a) + f.X[k * f.nb + b + 1] * a;
}

// Crossing of vertical line i and horizontal line j, rect coords.
function cross(V: Fam, Hf: Fam, i: number, j: number): Point {
  let x = V.X[i * V.nb + V.b0], y = 0;
  for (let it = 0; it < 5; it++) { y = at(Hf, j, x); x = at(V, i, y); }
  return { x, y };
}

// Lattice peaks of band b0: local maxima, then the best chain with gaps of 1–3 pitches (gaps filled).
function latticeSeeds(f: Fam): number[] {
  const { p, w, b0 } = f, prof = cover(f, b0, 1, w - 2, 0), R = Math.round(0.3 * p), pk: number[] = [];
  const cv = (x: number) => prof[Math.max(1, Math.min(w - 2, x))]; // prof[i] is x = i
  for (let x = 1; x < w - 1; x++) {
    const v = cv(x);
    if (v < MIN_COV) continue;
    let max = true;
    for (let d = -R; d <= R && max; d++) if (d && (cv(x + d) > v || (d < 0 && cv(x + d) === v))) max = false;
    if (max) pk.push(peak(f, b0, x, 1, 0)[0]);
  }
  const score = pk.map(() => 1), prev = pk.map(() => -1);
  for (let i = 0; i < pk.length; i++) for (let j = 0; j < i; j++) {
    const g = (pk[i] - pk[j]) / p, m = Math.round(g);
    if (m < 1 || m > 3 || Math.abs(g - m) > 0.25) continue;
    const s = score[j] + 1 - 0.5 * (m - 1);
    if (s > score[i]) { score[i] = s; prev[i] = j; }
  }
  const out: number[] = [];
  for (let e = score.indexOf(Math.max(...score)); e >= 0; e = prev[e]) {
    out.unshift(pk[e]);
    const j = prev[e], m = j >= 0 ? Math.round((pk[e] - pk[j]) / p) : 0;
    for (let q = m - 1; q >= 1; q--) out.unshift(pk[j] + ((pk[e] - pk[j]) * q) / m);
  }
  return out;
}

// Fraction of points of line k between coordinates lo and hi (middle 70%) that carry line ink.
function inkAlong(f: Fam, k: number, lo: number, hi: number): number {
  if (hi < lo) [lo, hi] = [hi, lo];
  const pad = 0.15 * (hi - lo);
  let hit = 0, n = 0;
  for (let y = Math.ceil(lo + pad); y <= hi - pad; y++, n++) {
    const x = Math.round(at(f, k, y));
    if (y < 0 || y >= f.h || x < 2 || x >= f.w - 2) continue;
    const o = y * f.w + x;
    if (f.m[o - 2] | f.m[o - 1] | f.m[o] | f.m[o + 1] | f.m[o + 2]) hit++;
  }
  return n ? hit / n : 0;
}

// Share of the lines of `a` with ink in the strip between line k of `b` and its neighbour (or the
// extrapolated line one step outside when `out`). `cr(i, k)` = coordinate along a-line i where it meets b-line k.
function stripInk(a: Fam, b: Fam, cr: (i: number, k: number) => number, k: number, out: boolean): number {
  const inner = k === 0 ? 1 : k - 1;
  let n = 0;
  for (let i = 0; i < a.seeds.length; i++) {
    const c0 = cr(i, k), c1 = cr(i, inner);
    if (inkAlong(a, i, c0, out ? 2 * c0 - c1 : c1) >= 0.5) n++;
  }
  return n / a.seeds.length;
}

/**
 * The outermost line of a family is the table frame: perpendicular lines run through the strip just
 * inside it and not through the strip just outside. Drop lines outside the table (page edge, shadow);
 * add lines the start band missed (finger) or that are outside the photo (perpendicular lines run on).
 */
function fixEnds(V: Fam, Hf: Fam): void {
  const cy = (i: number, j: number) => cross(V, Hf, i, j).y, cx = (j: number, i: number) => cross(V, Hf, i, j).x;
  for (let round = 0; round < 12; round++) {
    let changed = false;
    for (const [f, g, cr] of [[V, Hf, cx], [Hf, V, cy]] as const) for (const end of [0, 1]) {
      const n = f.seeds.length, k = end ? n - 1 : 0, s = f.seeds;
      if (n > 3 && stripInk(g, f, cr, k, false) < 0.3) { if (end) s.pop(); else s.shift(); changed = true; }
      else if (stripInk(g, f, cr, k, true) >= 0.3) {
        if (end) s.push(2 * s[n - 1] - s[n - 2]); else s.unshift(2 * s[0] - s[1]);
        changed = true;
      } else continue;
      track(f);
    }
    if (!changed) return;
  }
}

/** Mesh from the outer table quad (Task 4), or null if no line lattice is found in it. rotation is 0 (detect sets it). */
export function meshTable(upright: GrayImage, quad: Point[]): TableGeometry | null {
  if (quad.length !== 4 || quad.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const rect = rectify(upright, quad), { w, h, M, tw, th, px, py } = rect;
  // start bands 1.5 cells inside the bottom (right) side: every line crosses them
  const V = family(rect.v, w, h, px, py, M + th - 1.5 * py), Hf = family(rect.hT, h, w, py, px, M + tw - 1.5 * px);
  V.seeds = latticeSeeds(V); Hf.seeds = latticeSeeds(Hf);
  if (V.seeds.length < 10 || Hf.seeds.length < 10) return null;
  track(V); track(Hf);
  fixEnds(V, Hf);
  const cols = V.seeds.length - 1, rows = Hf.seeds.length - 1;
  if (cols < 10 || rows < 10) return null;
  // corner box: the first vertical (horizontal) line with ink in the top row (left column) is its edge
  const firstInked = (f: Fam, start: (k: number) => number, step: number, n: number) => {
    let k = 1;
    while (k < n - 1 && inkAlong(f, k, start(k), start(k) + step) < 0.5) k++;
    return k;
  };
  const rd = firstInked(V, (k) => cross(V, Hf, k, 0).y, py, cols);
  const cd = firstInked(Hf, (j) => cross(V, Hf, 0, j).x, px, rows);
  const g = finish(rect, V, Hf, { width: cols - rd, height: rows - cd, colClueDepth: cd, rowClueDepth: rd });
  if (KNOWN_SIZES.some((s) => s.width === g.width && s.height === g.height)) return g;
  const near = KNOWN_SIZES.find((s) => Math.abs(s.width - g.width) <= 1 && Math.abs(s.height - g.height) <= 1);
  if (!near) return { ...g, confidence: g.confidence / 2 };
  const grid = [crossing(g, rd, cd), crossing(g, cols, cd), crossing(g, cols, rows), crossing(g, rd, rows)];
  const s = meshFromCorners(upright, grid, { ...near, colClueDepth: cd, rowClueDepth: rd });
  return { ...s, confidence: s.confidence / 2 };
}

// Second tracking pass with the corner box and the outside of the frame forbidden, then the crossings.
function finish(rect: Rect, V: Fam, Hf: Fam, size: TableSize): TableGeometry {
  const rd = size.rowClueDepth, cd = size.colClueDepth, cols = rd + size.width, rows = cd + size.height;
  // where each line starts and ends (first pass): frame to frame, box lines from the box edge
  const vEnds = V.seeds.map((_, k) => [cross(V, Hf, k, k > 0 && k < rd ? cd : 0).y, cross(V, Hf, k, rows).y]);
  const hEnds = Hf.seeds.map((_, j) => [cross(V, Hf, j > 0 && j < cd ? rd : 0, j).x, cross(V, Hf, cols, j).x]);
  const outside = (f: Fam, e: number[][]) => (k: number, b: number) => {
    const y = (b + 0.5) * f.bh;
    return y < e[k][0] || y > e[k][1];
  };
  V.forbid = outside(V, vEnds); Hf.forbid = outside(Hf, hEnds);
  track(V); track(Hf);
  const xs = new Float32Array((cols + 1) * (rows + 1)), ys = new Float32Array(xs.length);
  let found = 0, total = 0;
  for (let j = 0; j <= rows; j++) for (let k = 0; k <= cols; k++) {
    const p = cross(V, Hf, k, j), q = applyH(rect.toUp, p);
    xs[j * (cols + 1) + k] = q.x; ys[j * (cols + 1) + k] = q.y;
    if (k > 0 && j > 0 && k < rd && j < cd) continue;
    total++;
    const bv = Math.max(0, Math.min(V.nb - 1, Math.floor(p.y / V.bh))), bh = Math.max(0, Math.min(Hf.nb - 1, Math.floor(p.x / Hf.bh)));
    if (V.F[k * V.nb + bv] && Hf.F[j * Hf.nb + bh]) found++;
  }
  return { rotation: 0, ...size, cols, rows, xs, ys, confidence: found / total };
}

/** Manual fallback (spec §6.3 step 7): mesh from the 4 grid corners TL,TR,BR,BL and a known size. */
export function meshFromCorners(upright: GrayImage, gridCorners: Point[], size: TableSize): TableGeometry {
  const { width, height, colClueDepth: cd, rowClueDepth: rd } = size, cols = rd + width, rows = cd + height;
  const Hg = homography([{ x: rd, y: cd }, { x: cols, y: cd }, { x: cols, y: rows }, { x: rd, y: rows }], gridCorners);
  const quad = [{ x: 0, y: 0 }, { x: cols, y: 0 }, { x: cols, y: rows }, { x: 0, y: rows }].map((p) => applyH(Hg, p));
  const rect = rectify(upright, quad), { w, h, M, tw, th } = rect, px = tw / cols, py = th / rows;
  const V = family(rect.v, w, h, px, py, M + th - 1.5 * py), Hf = family(rect.hT, h, w, py, px, M + tw - 1.5 * px);
  V.seeds = Array.from({ length: cols + 1 }, (_, k) => M + k * px);
  Hf.seeds = Array.from({ length: rows + 1 }, (_, j) => M + j * py);
  track(V); track(Hf);
  return finish(rect, V, Hf, size);
}

export function detect(photo: GrayImage):
  { ok: true; geometry: TableGeometry; ms: number } | { ok: false; reason: string; rotation?: 0 | 1 | 2 | 3 } {
  const t0 = performance.now();
  const loc = locateTable(photo);
  if (!loc.ok) return { ok: false, reason: loc.reason };
  const { rotation, quad } = loc.value;
  const g = meshTable(rotate90(photo, rotation), quad);
  if (!g) return { ok: false, reason: 'no-lattice', rotation };
  return { ok: true, geometry: { ...g, rotation }, ms: performance.now() - t0 };
}
