import { describe, it, expect } from 'vitest';
import { toGray, downscale, rotate90, rotatePoint } from '../../src/vision/image';
import type { GrayImage } from '../../src/vision/types';

describe('image', () => {
  it('toGray uses luma weights', () => {
    const g = toGray(new Uint8ClampedArray([255, 0, 0, 255, 255, 255, 255, 255]), 2, 1);
    expect(Array.from(g.data)).toEqual([76, 255]);
  });
  it('downscale averages 2x2 blocks', () => {
    const img: GrayImage = { width: 4, height: 2, data: new Uint8Array([0, 4, 10, 10, 8, 12, 20, 30]) };
    const d = downscale(img, 2);
    expect([d.width, d.height, ...d.data]).toEqual([2, 1, 6, 18]);
  });
  it('rotate90 four times is identity and rotatePoint agrees', () => {
    const img: GrayImage = { width: 3, height: 2, data: new Uint8Array([1, 2, 3, 4, 5, 6]) };
    let r = img;
    for (let i = 0; i < 4; i++) r = rotate90(r, 1);
    expect(r).toEqual(img);
    for (const k of [1, 2, 3] as const) {
      const rot = rotate90(img, k);
      for (const [x, y] of [[0, 0], [2, 0], [0, 1], [2, 1]]) {
        const p = rotatePoint({ x, y }, 3, 2, k);
        expect(rot.data[p.y * rot.width + p.x]).toBe(img.data[y * 3 + x]);
      }
    }
    expect(rotate90(img, 1).data).toEqual(new Uint8Array([4, 1, 5, 2, 6, 3])); // clockwise
  });
});
