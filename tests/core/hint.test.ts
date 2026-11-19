import { readFileSync } from 'node:fs';
import { nextHint } from '../../src/core/hint';
import { solve } from '../../src/core/solver';
import { UNKNOWN, FILLED, EMPTY, type Puzzle } from '../../src/core/types';

/** Marks from rows joined by '/': '#' filled, 'x' empty, '.' unknown. */
const M = (s: string) =>
  Uint8Array.from([...s.replaceAll('/', '')], (ch) => (ch === '#' ? FILLED : ch === 'x' ? EMPTY : UNKNOWN));

// solution ####x/#xx#x/####x/#xxxx/#xxxx
const P5: Puzzle = { width: 5, height: 5,
  rows: [[4], [1, 1], [4], [1], [1]], cols: [[5], [1, 1], [1, 1], [3], []], givens: [] };

test('line hint picks the line with most new cells', () => {
  const h = nextHint(P5, M('...../...../...../...../.....'), solve(P5).reference!);
  // col 0 ([5]) and col 4 ([]) both force 5 cells; tie → lower index
  expect(h).toEqual({ kind: 'line', line: { axis: 'col', index: 0 }, cells: [0, 5, 10, 15, 20],
    values: [FILLED, FILLED, FILLED, FILLED, FILLED] });
});
test('line hint: rows before columns on a tie', () => {
  // col 0 and col 4 known; rows 0 and 2 ([4]) and col 3 ([3]) each give 3 new cells
  const h = nextHint(P5, M('#...x/#...x/#...x/#...x/#...x'), solve(P5).reference!);
  expect(h).toEqual({ kind: 'line', line: { axis: 'row', index: 0 }, cells: [1, 2, 3],
    values: [FILLED, FILLED, FILLED] });
});
test('givens count as filled', () => {
  const p = { ...P5, givens: [0, 5, 10, 15, 20] };
  const h = nextHint(p, M('...../...../...../...../.....'), solve(p).reference!);
  expect(h).toMatchObject({ kind: 'line', line: { axis: 'col', index: 4 } });
});
test('done', () => {
  const ref = solve(P5).reference!;
  expect(nextHint(P5, Uint8Array.from(ref.map((v) => (v === FILLED ? FILLED : UNKNOWN))), ref))
    .toEqual({ kind: 'done' });
});
test('done counts givens', () => {
  const p = { ...P5, givens: [0] };
  expect(nextHint(p, M('.###x/#xx#x/####x/#xxxx/#xxxx'), solve(p).reference!)).toEqual({ kind: 'done' });
});

// Unique 5×5 solution #x#xx/xx##x/xx#x#/xxxx#/##x#x. From an empty grid, line logic stops at
// .x.x./xx.#./.x#x./.x.../.#... with no line giving a new cell.
const STUCK: Puzzle = { width: 5, height: 5,
  rows: [[1, 1], [2], [1, 1], [1], [2, 1]], cols: [[1, 1], [1], [3], [1, 1], [2]], givens: [] };
test('probe when lines are stuck', () => {
  const h = nextHint(STUCK, M('.x.x./xx.#./.x#x./.x.../.#...'), solve(STUCK).reference!);
  // Cell 0 filled breaks nothing; cell 0 empty forces row 0 to xx#x# and propagation then breaks row 2.
  expect(h).toEqual({ kind: 'probe', cell: 0, value: FILLED, contradiction: { axis: 'row', index: 1 } });
});
test('probe skips cells unknown in reference', () => {
  const ref = solve(STUCK).reference!;
  ref[0] = UNKNOWN;
  const h = nextHint(STUCK, M('.x.x./xx.#./.x#x./.x.../.#...'), ref);
  expect(h.kind).toBe('probe');
  expect(h).not.toMatchObject({ cell: 0 });
});
test('reveal when nothing else helps', () => {
  // 2×4: rows 2–3 hold a diagonal that can go either way. Give the reference one of the two
  // diagonals, so neither lines nor assumptions reach it.
  const p = { width: 2, height: 4, rows: [[2], [], [1], [1]], cols: [[1, 1], [1, 1]], givens: [] };
  const ref = M('##/xx/#x/x#');
  expect(nextHint(p, M('##/xx/../..'), ref)).toEqual({ kind: 'reveal', cell: 4, value: FILLED });
});
test('reveal skips cells unknown in reference', () => {
  const p = { width: 2, height: 4, rows: [[2], [], [1], [1]], cols: [[1, 1], [1, 1]], givens: [] };
  const ref = M('##/xx/.x/x#');
  expect(nextHint(p, M('##/xx/../..'), ref)).toEqual({ kind: 'reveal', cell: 5, value: EMPTY });
});
test('j37 with empty marks is fast', () => {
  const p: Puzzle = JSON.parse(readFileSync('tests/fixtures/puzzles/j37-25x35.json', 'utf8'));
  const ref = solve(p).reference!;
  const t = performance.now();
  const h = nextHint(p, new Uint8Array(p.width * p.height), ref);
  expect(performance.now() - t).toBeLessThan(1000);
  expect(h.kind).toBe('line');
});
