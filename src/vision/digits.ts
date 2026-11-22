import type { GrayImage } from './types';

export const GLYPH_BOX = 16; // 16x16 keeps 6/8/9 loops apart; 256 values per sample is still tiny
export interface Sample { d: string; v: number[] }

const MIN_CONTRAST = 60; // below this (max - min) the cell holds only paper and noise
const SPECK = 0.004; // components smaller than this share of the cell area are noise
const THIN = 0.12; // an edge-touching component thinner than this share of the cell is a grid line
const MAX_WIDTH = 0.7; // a merged glyph wider than this share of the cell is two touching digits

function otsu(data: Uint8Array): number {
  const h = new Array<number>(256).fill(0);
  for (const v of data) h[v]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * h[i];
  let wB = 0, sB = 0, best = -1, t = 0;
  for (let i = 0; i < 256; i++) {
    wB += h[i]; sB += i * h[i];
    const wF = data.length - wB;
    if (!wB || !wF) continue;
    const d = sB / wB - (sum - sB) / wF, s = wB * wF * d * d;
    if (s > best) { best = s; t = i; }
  }
  return t;
}

interface Comp { x0: number; x1: number; y0: number; y1: number; px: number[] }

/** Ink glyphs of one clue cell, left to right, each cropped to its ink (ink = 0, paper = 255). [] = empty, null = cannot split. */
export function glyphs(cell: GrayImage): GrayImage[] | null {
  const { width: w, height: h, data } = cell;
  let lo = 255, hi = 0;
  for (const v of data) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (hi - lo < MIN_CONTRAST) return [];
  const t = otsu(data), seen = new Uint8Array(w * h), comps: Comp[] = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || data[s] > t) continue;
    const c: Comp = { x0: w, x1: -1, y0: h, y1: -1, px: [] }, stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!, x = p % w, y = (p - x) / w;
      c.px.push(p); c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x); c.y0 = Math.min(c.y0, y); c.y1 = Math.max(c.y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, n = ny * w + nx;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && !seen[n] && data[n] <= t) { seen[n] = 1; stack.push(n); }
      }
    }
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    const edge = c.x0 === 0 || c.y0 === 0 || c.x1 === w - 1 || c.y1 === h - 1;
    if (c.px.length < SPECK * w * h || (edge && Math.min(bw / w, bh / h) < THIN)) continue;
    comps.push(c);
  }
  comps.sort((a, b) => a.x0 - b.x0);
  const groups: Comp[] = [];
  for (const c of comps) {
    const g = groups[groups.length - 1];
    if (g && c.x0 <= g.x1) { g.x1 = Math.max(g.x1, c.x1); g.y0 = Math.min(g.y0, c.y0); g.y1 = Math.max(g.y1, c.y1); g.px.push(...c.px); } else groups.push(c);
  }
  if (groups.length > 2 || groups.some((g) => (g.x1 - g.x0 + 1) > MAX_WIDTH * w)) return null;
  return groups.map((g) => {
    const gw = g.x1 - g.x0 + 1, gh = g.y1 - g.y0 + 1, out = new Uint8Array(gw * gh).fill(255);
    for (const p of g.px) out[(Math.floor(p / w) - g.y0) * gw + (p % w) - g.x0] = 0;
    return { width: gw, height: gh, data: out };
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

export function nearest(v: number[], samples: Sample[]): { d: string; dist: number; other: number } {
  const dist = (a: number[]) => Math.sqrt(a.reduce((s, x, i) => s + (x - v[i]) ** 2, 0));
  let best = { d: '', dist: Infinity }, other = Infinity;
  const ds = samples.map((s) => ({ d: s.d, dist: dist(s.v) }));
  for (const s of ds) if (s.dist < best.dist) best = s;
  for (const s of ds) if (s.d !== best.d && s.dist < other) other = s.dist;
  return { d: best.d, dist: best.dist, other };
}
