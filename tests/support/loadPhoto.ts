import { existsSync, readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { toGray } from '../../src/vision/image';
import type { GrayImage } from '../../src/vision/types';

// Node only. Returns null when the photo is absent (CI has none).
export function loadPhoto(path: string): GrayImage | null {
  if (!existsSync(path)) return null;
  const { width, height, data } = jpeg.decode(readFileSync(path), { useTArray: true, formatAsRGBA: true });
  return toGray(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width, height);
}
