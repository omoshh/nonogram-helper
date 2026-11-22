import { describe, it, expect } from 'vitest';
import { glyphs, glyphVector, nearest, GLYPH_BOX } from '../../src/vision/digits';
import type { GrayImage } from '../../src/vision/types';

const cell = (rects: number[][], noise = 0): GrayImage => {
  const im = { width: 40, height: 40, data: new Uint8Array(1600).fill(255) };
  if (noise) for (let i = 0; i < 1600; i++) im.data[i] = 255 - ((i * 7919) % (2 * noise + 1));
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) im.data[y * 40 + x] = 20;
  return im;
};

describe('glyphs', () => {
  it('empty cell gives no glyphs', () => expect(glyphs(cell([], 10))).toEqual([]));
  it('one bar is one glyph, two bars are two, left first', () => {
    expect(glyphs(cell([[18, 8, 22, 32]]))).toHaveLength(1);
    const g = glyphs(cell([[8, 10, 12, 30], [26, 14, 30, 26]]))!;
    expect(g.map((x) => x.height)).toEqual([20, 12]);
  });
  it('a broken glyph stays one glyph', () => expect(glyphs(cell([[18, 8, 22, 19], [18, 21, 22, 32]]))).toHaveLength(1));
  it('edge line ink is dropped', () => {
    expect(glyphs(cell([[0, 0, 3, 40]]))).toEqual([]);
    expect(glyphs(cell([[0, 0, 3, 40], [18, 8, 22, 32]]))).toHaveLength(1);
  });
  it('three glyphs cannot be split', () => expect(glyphs(cell([[4, 8, 8, 32], [18, 8, 22, 32], [32, 8, 36, 32]]))).toBeNull());
  it('a glyph too wide for one digit cannot be split', () => expect(glyphs(cell([[4, 8, 36, 32]]))).toBeNull());
});

describe('nearest', () => {
  it('picks the closest sample and reports the runner-up', () => {
    const A = Array(GLYPH_BOX ** 2).fill(0), A2 = A.slice(), B = A.slice();
    A2[0] = 0.5; B.fill(1, 0, 9);
    const r = nearest(A, [{ d: '1', v: A }, { d: '1', v: A2 }, { d: '7', v: B }]);
    expect(r).toEqual({ d: '1', dist: 0, other: 3 });
    expect(nearest(A, [{ d: '1', v: A }]).other).toBe(Infinity);
  });
});

describe('glyphVector', () => {
  it('is size-independent', () => {
    const v = (w: number, h: number) => glyphVector(glyphs(cell([[10, 5, 10 + w, 5 + h]]))![0]);
    const a = v(2, 10), b = v(4, 20);
    // same shape at 2x: only sub-pixel rounding of the sampling differs, well under one full pixel (1.0)
    expect(Math.hypot(...a.map((x, i) => x - b[i]))).toBeLessThan(0.5);
  });
});
