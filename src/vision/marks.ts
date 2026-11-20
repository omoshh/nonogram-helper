import { EMPTY, FILLED, UNKNOWN } from '../core/types';
import type { GrayImage } from './types';

export const MARK_PX = 24;

export interface MarksResult { cells: Uint8Array; unsure: number[] }

// ---- tunable constants (task 4 tunes these on real photos) ----
const DARK = 0.3;            // a pixel is ink when it is this much darker than the paper (0..1)
const PAPER_PCT = 0.9;       // paper level = this percentile of a patch
const GLOBAL_PAPER_PCT = 0.8; // ... or of all patches, when a patch is mostly dark
const MOSTLY_DARK = 0.8;     // patch paper below this share of the global paper = mostly dark
const MIN_BLOB = 4;          // px; smaller specks are noise
const DIGIT_FILL = 0.7;      // digit: dark area / bbox area below this (7, rings 0/6/8/9) ...
const DIGIT_SIZE = 0.375;    // ... and bbox side at least this share of the patch (9/24)
const DIGIT_NARROW = 3;      // ... or a long straight stroke (1): short side at most this many px
const DOT_MIN_INK = 0.02;    // ink share below this = blank
const NOISE_INK = 0.008;     // between NOISE_INK and DOT_MIN_INK: unexplained ink -> unsure
const FILLED_MIN_INK = 0.25; // used when the photo has only one mark group
const SPLIT_RATIO = 3;       // two groups only when their centres differ by this factor
const SPLIT_CLAMP: [number, number] = [0.12, 0.4]; // dot/filled boundary stays in this range
const BAND = 1.5;            // ink within boundary/BAND .. boundary*BAND = unsure
const OFF_CENTRE = 0.33;     // dot blob centre further than this share of the patch from the middle = unsure

const percentile = (vals: ArrayLike<number>, p: number) => {
  const s = Array.from(vals).sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

interface Features { ink: number; blobOffset: number } // ink = share of patch covered by non-digit dark blobs

function features(img: GrayImage, paper: number): Features {
  const { width: w, height: h, data } = img;
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < dark.length; i++) dark[i] = (paper - data[i]) / paper > DARK ? 1 : 0;
  const seen = new Uint8Array(w * h);
  let ink = 0, bestArea = 0, bestOffset = 0;
  for (let s = 0; s < dark.length; s++) {
    if (!dark[s] || seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    let area = 0, sx = 0, sy = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p / w) | 0;
      area++; sx += x; sy += y;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && dark[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    if (area < MIN_BLOB) continue;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const long = Math.max(bw, bh) >= DIGIT_SIZE * Math.min(w, h);
    if (long && (area / (bw * bh) < DIGIT_FILL || Math.min(bw, bh) <= DIGIT_NARROW)) continue; // printed digit
    ink += area;
    if (area > bestArea) {
      bestArea = area;
      bestOffset = Math.hypot(sx / area - (w - 1) / 2, sy / area - (h - 1) / 2) / Math.min(w, h);
    }
  }
  return { ink: ink / (w * h), blobOffset: bestOffset };
}

/** 1-D 2-means on log(ink); returns the two centres (low, high) in ink units. */
function twoMeans(vals: number[]): [number, number] {
  const l = vals.map(Math.log);
  let a = Math.min(...l), b = Math.max(...l);
  for (let it = 0; it < 20; it++) {
    const m = (a + b) / 2;
    const lo = l.filter((v) => v <= m), hi = l.filter((v) => v > m);
    if (!lo.length || !hi.length) break;
    a = lo.reduce((s, v) => s + v, 0) / lo.length;
    b = hi.reduce((s, v) => s + v, 0) / hi.length;
  }
  return [Math.exp(a), Math.exp(b)];
}

export function readMarks(patches: GrayImage[], givens: ReadonlySet<number>): MarksResult {
  const cells = new Uint8Array(patches.length);
  const unsure: number[] = [];
  const own = patches.map((p, i) => (givens.has(i) ? -1 : percentile(p.data, PAPER_PCT))).filter((v) => v >= 0);
  const globalPaper = own.length ? percentile(own, GLOBAL_PAPER_PCT) : 255;

  const feats = new Map<number, Features>();
  patches.forEach((p, i) => {
    if (givens.has(i)) { cells[i] = FILLED; return; }
    const mine = percentile(p.data, PAPER_PCT);
    const paper = mine < MOSTLY_DARK * globalPaper ? globalPaper : mine;
    feats.set(i, features(p, Math.max(paper, 1)));
  });

  const marked = [...feats].filter(([, f]) => f.ink >= DOT_MIN_INK);
  let boundary = Infinity; // ink above this = filled
  if (marked.length) {
    const [lo, hi] = twoMeans(marked.map(([, f]) => f.ink));
    boundary = hi / lo >= SPLIT_RATIO ? Math.min(Math.max(Math.sqrt(lo * hi), SPLIT_CLAMP[0]), SPLIT_CLAMP[1])
      : (hi > FILLED_MIN_INK ? 0 : Infinity); // one group: all filled or all dots
  }

  for (const [i, f] of feats) {
    if (f.ink < DOT_MIN_INK) {
      if (f.ink >= NOISE_INK) unsure.push(i);
      continue;
    }
    const filled = f.ink > boundary;
    cells[i] = filled ? FILLED : EMPTY;
    const nearBorder = boundary > 0 && boundary < Infinity && f.ink > boundary / BAND && f.ink < boundary * BAND;
    if (nearBorder || (!filled && f.blobOffset > OFF_CENTRE)) unsure.push(i);
  }
  return { cells, unsure: unsure.sort((a, b) => a - b) };
}
