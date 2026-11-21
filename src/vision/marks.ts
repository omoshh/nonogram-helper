import { EMPTY, FILLED, UNKNOWN } from '../core/types';
import type { GrayImage } from './types';

export const MARK_PX = 24;

/**
 * `overrides` = cells where a strong dot on uneven (not flat) paper beat fill evidence (past the cut or in its doubt band); all are unsure.
 * `retake` = more unsure cells than 1 % of the grid: shadow or blur, a new photo will read better.
 */
export interface MarksResult { cells: Uint8Array; unsure: number[]; overrides: number; retake: boolean }

// ---- constants, tuned on the 13 labelled photos (8 in task 4, shadow guard on the 25x35 set); pixel sizes assume MARK_PX = 24 ----
const PAPER_PCT = 0.9;       // a patch's own paper level = this percentile
const PAPER_WIDE = 8;        // cells: window radius for the photo-wide paper level (beats big filled blocks)
const PAPER_LIKE = 0.93;     // a patch is paper-like when its paper level is >= this share of the wide level
const PAPER_NEAR = 3;        // cells: local paper = NEAR_PCT of paper-like patches within this radius (shadows)
const NEAR_PCT = 0.75;
const SPLIT_GAP = 0.2;       // fill/non-fill groups are only split when their centres differ this much
const MIN_SPREAD = 0.015;    // floor for the non-fill group's interquartile range
const FILL_K = 3.4;          // filled = fill score below non-fill median - FILL_K spreads ...
const FILL_BAND = 0.4;       // ... unsure within +-FILL_BAND spreads of that
const DEEP_K = 6;            // a strong dot overrides "filled" unless the cell is deeper than DEEP_K spreads
const FLAT_SURE = 0.95;      // ... and is a sure dot when median/own is above this: flat paper dimmed by light fall-off (fills with dot > 0.34 <= 0.886, fall-off dots >= 0.964; untested: a glare-washed fill with one heavy stroke)
const DOT_STRONG = 0.34;     // dot contrast that marks a dot even on greyish paper (shadow, smudge)
const DOT_BOX = 5;           // px: dot contrast = darkest DOT_BOX^2 box vs the patch median ...
const DOT_EDGE = 1;          // ... with the box at least this far from the patch edge
const DOT_MIN = 0.12;        // dot contrast above this = dot ...
const DOT_BAND = 1.1;        // ... unsure within /DOT_BAND .. *DOT_BAND
const OFF_CENTRE = 0.38;     // dot box centre further than this share of the patch from the middle = unsure (a stray stroke sat at 0.3875: margin 0.0075)
const DARK = 0.3;            // a pixel is ink when this much darker than the patch median
const BIG_DOT = 135;         // px of ink: a "dot" larger than any real dot (half-way to filled) = unsure
const DIGIT_X = 15, DIGIT_Y = 9; // printed region numbers sit in this bottom-right corner, cut by the patch edge
const LINE_W = 3, LINE_L = 8;    // grid-line remnant: edge-touching ink at most LINE_W thick, LINE_L long
// Shadow guard (task 7): shaded paper can be darker than a lit fill, so these calls go to unsure instead.
// Solid ink (marker, pen) is as smooth as paper: such fills all go to unsure (fails safe, likely a retake).
const FLAT = 0.9;            // median/own above this = no hatching: flat paper, however dim ...
const FLAT_DOT = 0.25;       // ... and with a dot on it, a "filled" call is a shaded dot as likely (shaded dots >= 0.34; 0.2 already retakes good photos)
const GRAIN_FILL = 0.03;     // filled group's median grain below this = smooth like paper: shadow, not pencil
const STEP_FILL = 3.2;       // grey levels: a filled cell's own mean pixel step below this = paper noise, not pencil (shaded paper <= 2.71, sure pencil >= 3.76)
const DOT_FAINT = 0.073;     // contrast below the dot band but above this, centred or with ink = a blurred dot? (blank 0.0717, faint dot 0.0761: tight)
const FAINT_OFF = 0.2;      // ... centred = dot box centre within this share of the patch from the middle
const RETAKE = 0.01;         // more unsure than this share of the grid = ask for a new photo

const S = MARK_PX;

const percentile = (vals: ArrayLike<number>, p: number) => {
  const s = Float64Array.from(vals).sort();
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

/** Copy of the patch with printed digits and grid-line remnants painted over with `med`. */
function maskPrint(data: Uint8Array, med: number): Float64Array {
  const out = Float64Array.from(data), seen = new Uint8Array(S * S);
  const ink = (k: number) => (med - data[k]) / med > DARK;
  for (let s = 0; s < S * S; s++) {
    if (seen[s] || !ink(s)) continue;
    const stack = [s], px: number[] = [];
    seen[s] = 1;
    let x0 = S, x1 = 0, y0 = S, y1 = 0;
    while (stack.length) {
      const p = stack.pop()!, x = p % S, y = (p / S) | 0;
      px.push(p);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const q of [x > 0 ? p - 1 : -1, x < S - 1 ? p + 1 : -1, y > 0 ? p - S : -1, y < S - 1 ? p + S : -1]) {
        if (q >= 0 && !seen[q] && ink(q)) { seen[q] = 1; stack.push(q); }
      }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, edge = x0 === 0 || y0 === 0 || x1 === S - 1 || y1 === S - 1;
    if (x0 >= DIGIT_X && y0 >= DIGIT_Y && (x1 === S - 1 || y1 === S - 1)) {
      for (let y = DIGIT_Y; y < S; y++) for (let x = DIGIT_X; x < S; x++) out[y * S + x] = med;
    } else if (edge && Math.min(w, h) <= LINE_W && Math.max(w, h) >= LINE_L) for (const p of px) out[p] = med;
  }
  return out;
}

interface Features { fill: number; dot: number; off: number; area: number; flat: number; grain: number; step: number }

function features(data: Uint8Array, paper: number, own: number): Features {
  const med = Math.max(percentile(data, 0.5), 1), q = maskPrint(data, med);
  let best = Infinity, bx = 0, by = 0, area = 0;
  for (let y = DOT_EDGE; y + DOT_BOX <= S - DOT_EDGE; y++) for (let x = DOT_EDGE; x + DOT_BOX <= S - DOT_EDGE; x++) {
    let sum = 0;
    for (let dy = 0; dy < DOT_BOX; dy++) for (let dx = 0; dx < DOT_BOX; dx++) sum += q[(y + dy) * S + x + dx];
    if (sum < best) { best = sum; bx = x; by = y; }
  }
  for (const v of q) if ((med - v) / med > DARK) area++;
  let grain = 0; // mean step between neighbour pixels: pencil is grainy, shaded paper smooth
  for (let y = 0; y < S; y++) for (let x = 1; x < S; x++) grain += Math.abs(q[y * S + x] - q[y * S + x - 1]);
  return {
    // median vs local paper, times (median vs own paper)^2: hatching is both darker and uneven
    fill: (med / paper) * (med / own) ** 2,
    dot: (med - best / DOT_BOX ** 2) / med,
    off: Math.hypot(bx + DOT_BOX / 2 - S / 2, by + DOT_BOX / 2 - S / 2) / S,
    area,
    flat: med / own,
    grain: grain / (S * (S - 1)) / med,
    step: grain / (S * (S - 1)),
  };
}

/** Local paper level per cell from paper-like neighbours, so lighting gradients and shadows cancel. */
function paperLevels(own: number[], skip: (i: number) => boolean, width: number): number[] {
  const height = Math.ceil(own.length / width);
  const near = (i: number, r: number, ok: (j: number) => boolean) => {
    const row = Math.floor(i / width), col = i % width, v: number[] = [];
    for (let y = Math.max(0, row - r); y <= Math.min(height - 1, row + r); y++)
      for (let x = Math.max(0, col - r); x <= Math.min(width - 1, col + r); x++) {
        const j = y * width + x;
        if (j < own.length && ok(j)) v.push(own[j]);
      }
    return v;
  };
  const wide = own.map((v, i) => {
    const w = near(i, PAPER_WIDE, (j) => !skip(j));
    return w.length ? percentile(w, PAPER_PCT) : v; // only givens around: they are never classified anyway
  });
  const like = own.map((v, i) => !skip(i) && v >= PAPER_LIKE * wide[i]);
  return own.map((_, i) => {
    const v = near(i, PAPER_NEAR, (j) => like[j]);
    return v.length >= 3 ? percentile(v, NEAR_PCT) : wide[i];
  });
}

/** Upper (non-fill) group of fill scores: 1-D 2-means, or everything when there is no clear second group. */
function nonFill(vals: number[]): number[] {
  let a = Math.min(...vals), b = Math.max(...vals), m = (a + b) / 2;
  for (let it = 0; it < 30; it++) {
    m = (a + b) / 2;
    const lo = vals.filter((v) => v <= m), hi = vals.filter((v) => v > m);
    if (!lo.length || !hi.length) break;
    a = lo.reduce((s, v) => s + v, 0) / lo.length;
    b = hi.reduce((s, v) => s + v, 0) / hi.length;
  }
  return b - a >= SPLIT_GAP ? vals.filter((v) => v > m) : vals;
}

/** `width` = grid columns (patches are row-major); required: a wrong width silently degrades real photos. */
export function readMarks(patches: GrayImage[], givens: ReadonlySet<number>, width: number): MarksResult {
  const cells = new Uint8Array(patches.length);
  const unsure: number[] = [];
  const own = patches.map((p) => Math.max(percentile(p.data, PAPER_PCT), 1));
  const paper = paperLevels(own, (i) => givens.has(i), width);
  const feats = new Map<number, Features>();
  patches.forEach((p, i) => {
    if (givens.has(i)) cells[i] = FILLED;
    else feats.set(i, features(p.data, paper[i], own[i]));
  });
  if (!feats.size) return { cells, unsure, overrides: 0, retake: false };

  const upper = nonFill([...feats.values()].map((f) => f.fill));
  const mid = percentile(upper, 0.5);
  const spread = Math.max(percentile(upper, 0.75) - percentile(upper, 0.25), MIN_SPREAD);
  const cut = mid - FILL_K * spread;

  const isStrong = (f: Features) => f.dot > DOT_STRONG && f.fill > mid - DEEP_K * spread;
  const darkGrain = [...feats.values()].filter((f) => f.fill < cut && !isStrong(f)).map((f) => f.grain);
  const smoothDark = darkGrain.length > 0 && percentile(darkGrain, 0.5) < GRAIN_FILL;

  let overrides = 0;
  for (const [i, f] of feats) {
    const strong = isStrong(f);
    const filled = f.fill < cut && !strong;
    const shaded = filled && (smoothDark || f.step < STEP_FILL || (f.flat > FLAT && f.dot > FLAT_DOT));
    const fillDoubt = !strong && Math.abs(f.fill - cut) < FILL_BAND * spread;
    const override = strong && f.fill < cut + FILL_BAND * spread && f.flat <= FLAT_SURE; // never silent: could hide a filled cell
    if (override) overrides++;
    const dot = !filled && f.dot > DOT_MIN;
    const dotDoubt = !filled && f.dot > DOT_MIN / DOT_BAND && f.dot < DOT_MIN * DOT_BAND;
    const faint = !filled && !dot && f.dot > DOT_FAINT && (f.off < FAINT_OFF || f.area > 0);
    cells[i] = filled ? FILLED : dot ? EMPTY : UNKNOWN;
    if (fillDoubt || override || dotDoubt || shaded || faint || (dot && (f.off > OFF_CENTRE || f.area > BIG_DOT))) unsure.push(i);
  }
  unsure.sort((a, b) => a - b);
  return { cells, unsure, overrides, retake: unsure.length > Math.floor(RETAKE * patches.length) };
}
