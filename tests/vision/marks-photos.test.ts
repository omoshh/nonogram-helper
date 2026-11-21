import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { EMPTY, FILLED, UNKNOWN } from '../../src/core/types';
import { rotate90 } from '../../src/vision/image';
import { readMarks, MARK_PX } from '../../src/vision/marks';
import { meshFromCorners } from '../../src/vision/mesh';
import { cellPatches } from '../../src/vision/strips';
import type { GrayImage } from '../../src/vision/types';
import { loadPhoto } from '../support/loadPhoto';
import { forEachMarkPhoto, MARK_LABELS, type MarkLabel } from './marks-labels';

const WANT: Record<string, number> = { '#': FILLED, '.': EMPTY, '-': UNKNOWN, G: FILLED };
const CH = ['-', '#', '.'];
// Read well before the shadow guard: the guard must not push these to a retake.
const GOOD = /25x40-|PXL_|25x35-partial-1/;

const patchesOf = (l: MarkLabel, up: GrayImage) =>
  cellPatches(up, meshFromCorners(up, l.photo.gridCorners.map(([x, y]) => ({ x, y })), l.photo), MARK_PX);
const givensOf = (l: MarkLabel) => new Set([...l.cells].flatMap((c, i) => (c === 'G' ? [i] : [])));

function check(l: MarkLabel, patches: GrayImage[], givens: Set<number>, tag = '') {
  const { width, height } = l.photo;
  const t0 = performance.now();
  const { cells, unsure, overrides, retake } = readMarks(patches, givens, width);
  const ms = performance.now() - t0;
  const uns = new Set(unsure);
  let countable = 0, right = 0;
  const wrong: string[] = [], wrongSure: string[] = [], qSure: number[] = [];
  [...l.cells].forEach((c, i) => {
    if (c === '?') { if (!uns.has(i)) qSure.push(i); return; }
    countable++;
    if (cells[i] === WANT[c]) { right++; return; }
    const s = `(${Math.floor(i / width)},${i % width} ${c}>${CH[cells[i]]}${uns.has(i) ? '' : '!'})`;
    wrong.push(s);
    if (!uns.has(i)) wrongSure.push(s);
  });
  const acc = right / countable, limit = Math.floor(0.01 * width * height);
  console.log(`${l.photo.file}${tag}: acc ${(acc * 100).toFixed(2)} % wrong ${wrong.length} ${wrong.join(' ')} `
    + `unsure ${unsure.length}/${limit} overrides ${overrides} retake ${retake} ${ms.toFixed(0)} ms`);
  expect(retake).toBe(unsure.length > limit);
  // a retake read is never shown (CheckPage): the hard limits apply to every read the user sees
  if (!retake) {
    expect(wrongSure).toEqual([]);
    expect(qSure).toEqual([]);
    expect(acc).toBeGreaterThanOrEqual(0.995);
  }
  expect(ms).toBeLessThan(1000);
  return retake;
}

forEachMarkPhoto((l, img) => {
  it('marks meet the hard limits', () => {
    const retake = check(l, patchesOf(l, img()), givensOf(l));
    if (GOOD.test(l.photo.file)) expect(retake).toBe(false);
  }, 60_000);

  // The user may skip entering the givens: the printed cells are then read like any other cell.
  if (l.photo.file.includes('25x35-empty')) {
    it('marks meet the hard limits with no givens entered', () => {
      check(l, patchesOf(l, img()), new Set(), ' (no givens)');
    }, 60_000);
  }
});

// Shaded blank cells pasted into a photo with real pencil fills: the shadow must not hide behind the fills' grain.
const [empty, part] = ['25x35-empty', '25x35-partial-1'].map((n) => MARK_LABELS.find((l) => l.photo.file.includes(n))!);
describe.skipIf(!existsSync(empty.photo.file) || !existsSync(part.photo.file))('shadow composite', () => {
  it('shaded blanks from 25x35-empty in 25x35-partial-1 are never sure FILLED', () => {
    const up = (l: MarkLabel) => rotate90(loadPhoto(l.photo.file)!, l.photo.rotation);
    const shaded = patchesOf(empty, up(empty)), ps = patchesOf(part, up(part));
    const pasted: number[] = [];
    for (let r = 32; r < 35; r++) for (let c = 20; c < 25; c++) { const i = r * 25 + c; ps[i] = shaded[i]; pasted.push(i); }
    const { cells, unsure } = readMarks(ps, givensOf(part), 25);
    expect(pasted.filter((i) => cells[i] === FILLED && !unsure.includes(i))).toEqual([]);
  }, 60_000);
});
