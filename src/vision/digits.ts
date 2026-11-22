import type { GrayImage } from './types';
import { adaptiveThreshold } from './binary';

export const GLYPH_BOX = 12; // 144 values: 468 thinned samples fit in 183 KiB; 16 reads as well unthinned but only ~340 samples fit (up to 6 more wrong)
export interface Sample { d: string; v: number[] }

// Margins: the 12 clean-clue training photos, leave one puzzle out, clean sources (2026-11-22); "+n" = n more wrong cells.
const INSET = 0.12; // share of the cell skipped on each side (grid lines); 0.09..0.17 change no read
const ADAPT_R = 0.1; // local threshold window radius, share of the cell; 0.08 same, 0.12 +2
const INK_OFFSET = 15; // ink is this much darker than its local mean; 12 +1, 17 +2
const SPECK = 0.015; // components smaller than this share of the cell area are noise; 0.008 +1, 0.022 +3
const THIN = 0.12; // a component this thin that lies ALONG the edge it touches is a grid line; 0.06 +1, 0.3 same
const TALL = 0.85; // a component spanning this share of the inner box is a grid line (digits ~0.66); 0.75 same, 0.7 +38
const CENTRE_INK = 70; // contrast in the cell centre with no glyph = unreadable ink (crossed-out clue); 50..90 same; without it 770 sure-wrong cells on crossed photos
const MAX_WIDTH = 0.6; // a merged glyph wider than this share of the inner box is two touching digits; 0.45 +320, 0.8 same

interface Comp { x0: number; x1: number; y0: number; y1: number; px: number[] }

/** Ink glyphs of one clue cell, left to right, each cropped to its ink (ink = 0, paper = 255). [] = empty, null = cannot split. */
export function glyphs(cell: GrayImage): GrayImage[] | null {
  const a = Math.round(INSET * cell.width), b = Math.round(INSET * cell.height), w = cell.width - 2 * a, h = cell.height - 2 * b;
  const inner = { width: w, height: h, data: new Uint8Array(w * h) };
  for (let y = 0; y < h; y++) inner.data.set(cell.data.subarray((y + b) * cell.width + a, (y + b) * cell.width + a + w), y * w);
  const groups = inkGroups(inner, cell.width).map((g) => g.im);
  if (!groups.length) {
    let lo = 255, hi = 0;
    for (let y = Math.round(h / 4); y < h - h / 4; y++) for (let x = Math.round(w / 4); x < w - w / 4; x++) { const v = inner.data[y * w + x]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (hi - lo >= CENTRE_INK) return null;
  }
  if (groups.length > 2 || groups.some((g) => g.width > MAX_WIDTH * w)) return null;
  return groups;
}

/** Ink of an image as glyph groups (components overlapping in x merged), left to right; `cellPx` = clue cell size in px. */
export function inkGroups(im: GrayImage, cellPx: number): { x: number; y: number; im: GrayImage }[] {
  const { width: w, height: h } = im;
  const seen = new Uint8Array(w * h), comps: Comp[] = [], ink = adaptiveThreshold(im, Math.round(ADAPT_R * cellPx), INK_OFFSET);
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || !ink[s]) continue;
    const c: Comp = { x0: w, x1: -1, y0: h, y1: -1, px: [] }, stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!, x = p % w, y = (p - x) / w;
      c.px.push(p); c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x); c.y0 = Math.min(c.y0, y); c.y1 = Math.max(c.y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, n = ny * w + nx;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && !seen[n] && ink[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    const edge = c.x0 === 0 || c.y0 === 0 || c.x1 === w - 1 || c.y1 === h - 1;
    // a stem that merely reaches the top/bottom edge is thin but not along it, so it stays
    const along = (bw < THIN * w && (c.x0 === 0 || c.x1 === w - 1)) || (bh < THIN * h && (c.y0 === 0 || c.y1 === h - 1));
    if (c.px.length < SPECK * cellPx * cellPx || bh > TALL * h || bw > TALL * w || (edge && along)) continue;
    comps.push(c);
  }
  comps.sort((a, b) => a.x0 - b.x0);
  const groups: Comp[] = [];
  for (const c of comps) {
    const g = groups[groups.length - 1];
    if (g && c.x0 <= g.x1) { g.x1 = Math.max(g.x1, c.x1); g.y0 = Math.min(g.y0, c.y0); g.y1 = Math.max(g.y1, c.y1); g.px.push(...c.px); } else groups.push(c);
  }
  return groups.map((g) => {
    const gw = g.x1 - g.x0 + 1, gh = g.y1 - g.y0 + 1, out = new Uint8Array(gw * gh).fill(255);
    for (const p of g.px) out[(Math.floor(p / w) - g.y0) * gw + (p % w) - g.x0] = 0;
    return { x: g.x0, y: g.y0, im: { width: gw, height: gh, data: out } };
  });
}

/** Glyph scaled into GLYPH_BOX x GLYPH_BOX (aspect kept, centred), values 0..1, 1 = ink. */
export function glyphVector(glyph: GrayImage): number[] {
  const { width: w, height: h, data } = glyph, k = GLYPH_BOX / Math.max(w, h);
  const ox = (GLYPH_BOX - w * k) / 2, oy = (GLYPH_BOX - h * k) / 2, S = 4; // S x S sub-samples per output pixel
  const v: number[] = [];
  for (let y = 0; y < GLYPH_BOX; y++) for (let x = 0; x < GLYPH_BOX; x++) {
    let s = 0;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const sx = Math.floor((x + (i + 0.5) / S - ox) / k), sy = Math.floor((y + (j + 0.5) / S - oy) / k);
      if (sx >= 0 && sy >= 0 && sx < w && sy < h) s += 1 - data[sy * w + sx] / 255;
    }
    v.push(s / (S * S));
  }
  return v;
}

/** Nearest sample's digit, its distance, and the distance of the nearest sample of any other digit. */
export function nearest(v: number[], samples: Sample[]): { d: string; dist: number; other: number } {
  let d = '', best = Infinity, other = Infinity; // squared distances
  for (const s of samples) {
    const lim = s.d === d ? best : other, sv = s.v; // a sample counts only if it beats this; stop summing once it cannot
    let e = 0;
    for (let i = 0; i < sv.length && e < lim; i++) { const x = sv[i] - v[i]; e += x * x; }
    if (e >= lim) continue;
    if (s.d === d) best = e;
    else if (e < best) { other = best; best = e; d = s.d; } else other = e;
  }
  return { d, dist: Math.sqrt(best), other: Math.sqrt(other) };
}
