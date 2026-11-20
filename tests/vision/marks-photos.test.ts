import { it, expect } from 'vitest';
import { EMPTY, FILLED, UNKNOWN } from '../../src/core/types';
import { readMarks, MARK_PX } from '../../src/vision/marks';
import { meshFromCorners } from '../../src/vision/mesh';
import { cellPatches } from '../../src/vision/strips';
import { forEachMarkPhoto } from './marks-labels';

const WANT: Record<string, number> = { '#': FILLED, '.': EMPTY, '-': UNKNOWN, G: FILLED };
const CH = ['-', '#', '.'];

forEachMarkPhoto((l, img) => {
  it('marks meet the hard limits', () => {
    const { width, height } = l.photo;
    const up = img();
    const g = meshFromCorners(up, l.photo.gridCorners.map(([x, y]) => ({ x, y })), l.photo);
    const givens = new Set([...l.cells].flatMap((c, i) => (c === 'G' ? [i] : [])));
    const t0 = performance.now();
    const { cells, unsure } = readMarks(cellPatches(up, g, MARK_PX), givens, width);
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
    console.log(`${l.photo.file}: acc ${(acc * 100).toFixed(2)} % wrong ${wrong.length} ${wrong.join(' ')} `
      + `unsure ${unsure.length}/${limit} ${ms.toFixed(0)} ms`);
    expect(acc).toBeGreaterThanOrEqual(0.995);
    expect(wrongSure).toEqual([]);
    expect(qSure).toEqual([]);
    expect(unsure.length).toBeLessThanOrEqual(limit);
    expect(ms).toBeLessThan(1000);
  }, 60_000);
});
