import { describe, it, expect } from 'vitest';
import { synthTable } from '../support/synthTable';
import { rotate90 } from '../../src/vision/image';

// crossings strictly inside the corner box carry no ink by design
const inked = (i: number, j: number, rd: number, cd: number) => !(i > 0 && j > 0 && i < rd && j < cd);

function check(o: Parameters<typeof synthTable>[0], tol: number) {
  const rd = o.rowClueDepth, cd = o.colClueDepth, nx = rd + o.width + 1;
  const { img, corners } = synthTable(o);
  const up = rotate90(img, (o.rotation ?? 0) as 0 | 1 | 2 | 3);
  expect(corners.length).toBe(nx * (cd + o.height + 1));
  let n = 0;
  corners.forEach((c, k) => {
    if (!inked(k % nx, Math.floor(k / nx), rd, cd) || k % 7) return;
    n++;
    expect(up.data[Math.round(c.y) * up.width + Math.round(c.x)]).toBeLessThan(tol);
  });
  expect(n).toBeGreaterThan(20);
  return corners;
}

describe('synthTable', () => {
  it('undistorted: exact lattice, ink on lines', () => {
    const o = { width: 10, height: 8, colClueDepth: 3, rowClueDepth: 4, cell: 24 };
    const c = check(o, 100);
    const nx = 15;
    expect(c[1].x - c[0].x).toBeCloseTo(24, 6);
    expect(c[nx].y - c[0].y).toBeCloseTo(24, 6);
    expect(c[nx + 1].x - c[nx].x).toBeCloseTo(24, 6);
  });
  it('is deterministic', () => {
    const o = { width: 6, height: 5, colClueDepth: 2, rowClueDepth: 2, seed: 3, noise: 5, perspective: 0.02 };
    expect(synthTable(o).img.data).toEqual(synthTable(o).img.data);
  });
  it('perspective + bend + rotation keep ink on the returned corners', () => {
    for (const rotation of [0, 1, 2, 3] as const)
      check({ width: 12, height: 9, colClueDepth: 4, rowClueDepth: 3, perspective: 0.03, bend: 0.8, rotation, seed: 7 }, 140);
  });
});
