import type { GrayImage } from './types';

export function adaptiveThreshold(img: GrayImage, radius: number, offset: number): Uint8Array {
  const { width: w, height: h, data } = img;
  const sw = w + 1;
  const sum = new Float64Array(sw * (h + 1)); // integral image
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      sum[(y + 1) * sw + x + 1] = sum[y * sw + x + 1] + row;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius), y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(w, x + radius + 1);
      const s = sum[y1 * sw + x1] - sum[y0 * sw + x1] - sum[y1 * sw + x0] + sum[y0 * sw + x0];
      out[y * w + x] = data[y * w + x] < s / ((x1 - x0) * (y1 - y0)) - offset ? 1 : 0;
    }
  }
  return out;
}
