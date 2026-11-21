import { existsSync, readFileSync } from 'node:fs';
import { describe } from 'vitest';
import { rotate90 } from '../../src/vision/image';
import type { GrayImage } from '../../src/vision/types';
import { loadPhoto } from '../support/loadPhoto';
import { PHOTOS, NAMES, type PhotoLabel } from './photos';

/** Hand labels: # filled, . dot, - blank, G given, ? unreadable for sure. */
export interface MarkLabel { photo: PhotoLabel; cells: string /* row-major, length width*height */ }

const MARK_NAMES = [
  '25x40-partial-1',
  '25x40-partial-2',
  '25x40-solved',
  'PXL_20261119_103731459.MP',
  'PXL_20261119_103755636.MP~2',
  'PXL_20261119_103838011.MP',
  'PXL_20261119_103900588.MP~2',
  'PXL_20261119_103924589.MP',
  '25x35-empty',
  '25x35-partial-1',
  '25x35-partial-2',
  '25x35-partial-3',
  '25x35-solved',
  'PXL_20261120_123206340.MP',
  'PXL_20261121_061441349',
  'PXL_20261121_065427861',
  'PXL_20261121_074326501.MP',
];

export const MARK_ROWS: { photo: string; rows: string[] }[] = MARK_NAMES.map((n) =>
  JSON.parse(readFileSync(new URL(`../fixtures/marks/${n}.json`, import.meta.url), 'utf8')),
);

export const MARK_LABELS: MarkLabel[] = MARK_ROWS.map((m) => ({
  photo: PHOTOS[NAMES.indexOf(m.photo)],
  cells: m.rows.join(''),
}));

// One describe per photo, skipped when the photo is absent (CI). img() decodes once, upright.
export function forEachMarkPhoto(fn: (l: MarkLabel, img: () => GrayImage) => void): void {
  for (const l of MARK_LABELS) {
    let cached: GrayImage | undefined;
    const img = () => (cached ??= rotate90(loadPhoto(l.photo.file)!, l.photo.rotation));
    describe.skipIf(!existsSync(l.photo.file))(l.photo.file, () => fn(l, img));
  }
}
