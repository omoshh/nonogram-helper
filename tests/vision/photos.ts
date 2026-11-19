import { existsSync, readFileSync } from 'node:fs';
import { describe } from 'vitest';
import { rotate90 } from '../../src/vision/image';
import type { GrayImage } from '../../src/vision/types';
import { loadPhoto } from '../support/loadPhoto';

export interface PhotoLabel {
  file: string;
  journal: 'main' | 'other';
  rotation: 0 | 1 | 2 | 3;
  width: number;
  height: number;
  colClueDepth: number;
  rowClueDepth: number;
  gridCorners: [number, number][];
}

const NAMES = [
  'PXL_20261119_101316578.MP',
  'PXL_20261119_101959074.MP',
  'PXL_20261119_103145555.MP',
  'PXL_20261119_103148711.MP',
  'PXL_20261119_103313527.MP',
  'PXL_20261119_103325894.MP',
  'PXL_20261119_103334566.MP',
  'PXL_20261119_103344596.MP',
  'PXL_20261119_103355169.MP',
  'PXL_20261119_103731459.MP',
  'PXL_20261119_103755636.MP~2',
  'PXL_20261119_103838011.MP',
  'PXL_20261119_103900588.MP~2',
  'PXL_20261119_103924589.MP',
  '25x40-empty',
  'PXL_20261119_103513249.MP',
  'PXL_20261119_103520716.MP',
  'PXL_20261119_103529094.MP',
  'PXL_20261119_103533841.MP',
  'PXL_20261119_103538488.MP',
];

export const PHOTOS: PhotoLabel[] = NAMES.map((n) =>
  JSON.parse(readFileSync(new URL(`../fixtures/photos/${n}.json`, import.meta.url), 'utf8')),
);

// One describe per photo, skipped when the photo is absent (CI). img() decodes once, upright.
export function forEachPhoto(fn: (label: PhotoLabel, img: () => GrayImage) => void): void {
  for (const label of PHOTOS) {
    let cached: GrayImage | undefined;
    const img = () => (cached ??= rotate90(loadPhoto(label.file)!, label.rotation));
    describe.skipIf(!existsSync(label.file))(label.file, () => fn(label, img));
  }
}
