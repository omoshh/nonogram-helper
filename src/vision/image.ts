import type { GrayImage, Point } from './types';

type Turns = 0 | 1 | 2 | 3;

export function toGray(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.round(0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2]);
  }
  return { width, height, data };
}

export function downscale(img: GrayImage, factor: number): GrayImage {
  const w = Math.floor(img.width / factor), h = Math.floor(img.height / factor);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) s += img.data[(y * factor + dy) * img.width + x * factor + dx];
      }
      data[y * w + x] = Math.round(s / (factor * factor));
    }
  }
  return { width: w, height: h, data };
}

export function rotatePoint(p: Point, w: number, h: number, k: Turns): Point {
  if (k === 1) return { x: h - 1 - p.y, y: p.x };
  if (k === 2) return { x: w - 1 - p.x, y: h - 1 - p.y };
  if (k === 3) return { x: p.y, y: w - 1 - p.x };
  return { x: p.x, y: p.y };
}

export function rotate90(img: GrayImage, k: Turns): GrayImage {
  const { width: w, height: h } = img;
  const swap = k % 2 === 1;
  const out: GrayImage = { width: swap ? h : w, height: swap ? w : h, data: new Uint8Array(w * h) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = rotatePoint({ x, y }, w, h, k);
      out.data[p.y * out.width + p.x] = img.data[y * w + x];
    }
  }
  return out;
}
