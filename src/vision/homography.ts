import type { Point } from './types';

export type H = Float64Array; // 3x3 row-major

/** Homography mapping src[i] to dst[i] (exactly 4 points each), h[8] = 1. */
export function homography(src: Point[], dst: Point[]): H {
  if (src.length !== 4 || dst.length !== 4) throw new Error('need 4 points');
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) { // Gauss-Jordan with partial pivoting
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    if (Math.abs(a[c][c]) < 1e-12) throw new Error('degenerate points');
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let k = c; k < 9; k++) a[r][k] -= f * a[c][k];
    }
  }
  const h = new Float64Array(9);
  for (let i = 0; i < 8; i++) h[i] = a[i][8] / a[i][i];
  h[8] = 1;
  return h;
}

export function applyH(h: H, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

export function invertH(h: H): H {
  const [a, b, c, d, e, f, g, i, j] = h;
  const A = e * j - f * i, B = c * i - b * j, C = b * f - c * e;
  const det = a * A + d * B + g * C;
  if (Math.abs(det) < 1e-18) throw new Error('singular');
  return Float64Array.from([A, B, C, f * g - d * j, a * j - c * g, c * d - a * f, d * i - e * g, b * g - a * i, a * e - b * d].map((v) => v / det));
}
