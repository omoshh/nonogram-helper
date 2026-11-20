import { describe, it, expect } from 'vitest';
import { KNOWN_SIZES } from '../../src/core/clues';
import { PHOTOS, forEachPhoto } from './photos';

describe('photo labels (no photos needed)', () => {
  it('has 23 labels, 18 main and 5 other', () => {
    expect(PHOTOS).toHaveLength(23);
    expect(PHOTOS.filter((p) => p.journal === 'main')).toHaveLength(18);
  });

  for (const p of PHOTOS) {
    it(`${p.file}: known size, sane depths, convex clockwise quad`, () => {
      if (p.journal === 'main') expect(KNOWN_SIZES).toContainEqual({ width: p.width, height: p.height });
      expect(p.colClueDepth).toBeGreaterThan(0);
      expect(p.rowClueDepth).toBeGreaterThan(0);
      expect(p.gridCorners).toHaveLength(4);
      // TL,TR,BR,BL in image coords (y down): every turn has the same positive cross product.
      for (let i = 0; i < 4; i++) {
        const [a, b, c] = [0, 1, 2].map((d) => p.gridCorners[(i + d) % 4]);
        const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        expect(cross).toBeGreaterThan(0);
      }
      const [tl, tr, , bl] = p.gridCorners;
      expect(tr[0]).toBeGreaterThan(tl[0]);
      expect(bl[1]).toBeGreaterThan(tl[1]);
    });
  }
});

forEachPhoto((label, img) => {
  it('loads upright in the orientation the grid implies', () => {
    const { width, height } = img();
    expect(width > height).toBe(label.width > label.height);
  }, 60_000);
});
