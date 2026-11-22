import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { validate } from '../../src/core/validate';
import { solve } from '../../src/core/solver';
import { rotate90 } from '../../src/vision/image';
import { meshFromCorners, type TableGeometry } from '../../src/vision/mesh';
import { collectSamples, readClues, readLabel, type CellRead } from '../../src/vision/clueRead';
import type { Sample } from '../../src/vision/digits';
import type { GrayImage } from '../../src/vision/types';
import { loadPhoto } from '../support/loadPhoto';
import { thin, type Tagged } from './samples';
import { PHOTOS, PUZZLES, type PhotoLabel } from './photos';

const MAIN = PHOTOS.filter((p) => p.journal === 'main');
const blind = (p: PhotoLabel) => p.file.includes('/blind-');
interface Loaded { up: GrayImage; g: TableGeometry; samples: Tagged[] }
const loaded = new Map<string, Loaded>();
let thinned: Tagged[] | undefined; // THINNED=1: the generator's thinned, rounded set (Step 7 accuracy check)

// Decode each present photo once and collect its samples; only clean-clue, non-blind photos are sample sources.
beforeAll(() => {
  for (const p of MAIN) {
    if (!existsSync(p.file)) continue;
    const up = rotate90(loadPhoto(p.file)!, p.rotation), g = meshFromCorners(up, p.gridCorners.map(([x, y]) => ({ x, y })), p);
    const z = PUZZLES[p.puzzle!];
    loaded.set(p.file, { up, g, samples: blind(p) || p.cluesCrossed ? [] : collectSamples(up, g, z.rows, z.cols, z.label).map((s) => ({ ...s, p: p.puzzle! })) });
  }
  if (process.env.THINNED) thinned = thin([...loaded.values()].flatMap((l) => l.samples));
}, 600_000);

// Leave one puzzle out: samples from clean photos of OTHER puzzles; blind photos use the shipped samples.
const samplesFor = (p: PhotoLabel): Sample[] => blind(p)
  ? JSON.parse(readFileSync(new URL('../../src/vision/digit-samples.json', import.meta.url), 'utf8'))
  : (thinned ?? [...loaded.values()].flatMap((l) => l.samples)).filter((s) => s.p !== p.puzzle);

describe('clue reading on the photos', () => {
  for (const p of MAIN) {
    it.skipIf(!existsSync(p.file))(p.file, () => {
      const { up, g } = loaded.get(p.file)!, z = PUZZLES[p.puzzle!], S = samplesFor(p);
      const t0 = performance.now();
      const r = readClues(up, g, S);
      const ms = performance.now() - t0;
      const label = readLabel(up, g, S);
      const unsure = new Set(r.unsure.map((l) => `${l.axis}${l.index}`));
      let countable = 0, right = 0;
      const wrong: string[] = [], uncaught: string[] = [];
      const compare = (axis: 'row' | 'col', want: number[][], got: CellRead[][]) => want.forEach((clues, i) => {
        const cells = got[i], pad = Math.max(clues.length, cells.length);
        // right-aligned; a clue beyond the visible depth (photo cut it off) is a cell the reader cannot see
        const w = [...Array(pad - clues.length).fill(null), ...clues], v = [...Array(pad - cells.length).fill(null), ...cells.map((c) => c.value)];
        w.forEach((x, k) => {
          if (x === null && v[k] === null) return;
          countable++;
          if (x === v[k]) { right++; return; }
          const line = `${axis}${i}`, s = `(${axis} ${i} cell ${k - (pad - cells.length)}: ${x}>${v[k]}${unsure.has(line) ? '' : '!'})`;
          wrong.push(s);
          if (!unsure.has(line)) uncaught.push(s);
        });
      });
      compare('row', z.rows, r.rows);
      compare('col', z.cols, r.cols);
      const read = { width: z.width, height: z.height, rows: r.rowClues, cols: r.colClues, givens: z.givens };
      const caught = uncaught.length > 0 && (validate(read).length > 0 || solve(read, { timeLimitMs: 20000 }).status !== 'unique');
      const acc = right / countable, lab = label ? `${label.width}x${label.height}` : 'null';
      console.log(`${p.file}${p.cluesCrossed ? ' (crossed)' : ''}: countable ${countable} correct ${(acc * 100).toFixed(2)} % wrong ${wrong.length} ${wrong.join(' ')} `
        + `samples ${S.length} unsure ${r.unsure.length} label ${lab} vs ${z.width}x${z.height}${uncaught.length ? ` sure-wrong caught: ${caught}` : ''} ${ms.toFixed(0)} ms`);
      if (!p.cluesCrossed) expect(acc).toBeGreaterThanOrEqual(0.99); // crossed-out clues are out of scope; safety still holds
      if (uncaught.length) expect(caught).toBe(true);
      expect([null, `${z.width}x${z.height}`]).toContain(label && lab);
      expect(ms).toBeLessThan(1000);
    }, 120_000);
  }
});
