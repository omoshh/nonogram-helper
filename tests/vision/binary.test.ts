import { describe, it, expect } from 'vitest';
import { adaptiveThreshold } from '../../src/vision/binary';
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
  it('loadPhoto returns null for a missing file', () => {
    expect(loadPhoto('/nonexistent/photo.jpg')).toBeNull();
  });
});
