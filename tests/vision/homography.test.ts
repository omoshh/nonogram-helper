import { describe, it, expect } from 'vitest';
import { homography, applyH, invertH } from '../../src/vision/homography';

const src = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }];
const dst = [{ x: 12, y: 9 }, { x: 140, y: 20 }, { x: 120, y: 130 }, { x: 5, y: 90 }];

describe('homography', () => {
  it('maps the 4 points exactly', () => {
    const h = homography(src, dst);
    src.forEach((p, i) => {
      const q = applyH(h, p);
      expect(Math.hypot(q.x - dst[i].x, q.y - dst[i].y)).toBeLessThan(1e-6);
    });
  });
  it('invertH round-trips', () => {
    const h = homography(src, dst);
    const hi = invertH(h);
    for (const p of [{ x: 33, y: 41 }, { x: -5, y: 70 }]) {
      const q = applyH(hi, applyH(h, p));
      expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThan(1e-6);
    }
  });
});
