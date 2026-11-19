import { describe, it, expect } from 'vitest';
import { adaptiveThreshold, largestComponent } from '../../src/vision/binary';
import { loadPhoto } from '../support/loadPhoto';
import type { GrayImage } from '../../src/vision/types';

const gradient = (w: number, h: number): GrayImage => {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = 100 + x;
  return { width: w, height: h, data };
};

describe('binary', () => {
  it('adaptiveThreshold finds a thin line and ignores a plain gradient', () => {
    const img = gradient(60, 40);
    expect(adaptiveThreshold(img, 8, 10).some(v => v)).toBe(false);
    for (let y = 0; y < 40; y++) img.data[y * 60 + 30] = 0;
    const m = adaptiveThreshold(img, 8, 10);
    expect(m[20 * 60 + 30]).toBe(1);
    expect(m[20 * 60 + 10]).toBe(0);
  });
  it('largestComponent returns the bigger blob with bounds (8-connected)', () => {
    const w = 10, h = 6, m = new Uint8Array(w * h);
    m[0] = 1; m[1 * w + 1] = 1; // diagonal pair, size 2
    for (let y = 2; y < 5; y++) for (let x = 5; x < 9; x++) m[y * w + x] = 1; // 12 px
    const c = largestComponent(m, w, h);
    expect([c.pixels.length, c.minX, c.minY, c.maxX, c.maxY]).toEqual([12, 5, 2, 8, 4]);
  });
  it('loadPhoto returns null for a missing file', () => {
    expect(loadPhoto('/nonexistent/photo.jpg')).toBeNull();
  });
});
