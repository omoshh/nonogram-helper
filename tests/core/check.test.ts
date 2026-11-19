import { findMistakes } from '../../src/core/check';
import { solve } from '../../src/core/solver';
import { UNKNOWN, FILLED, EMPTY, type Puzzle } from '../../src/core/types';

/** Marks from rows joined by '/': '#' filled, 'x' empty, '.' unknown. */
const M = (s: string) =>
  Uint8Array.from([...s.replaceAll('/', '')], (ch) => (ch === '#' ? FILLED : ch === 'x' ? EMPTY : UNKNOWN));

// solution ####x/#xx#x/####x/#xxxx/#xxxx
const P5: Puzzle = { width: 5, height: 5,
  rows: [[4], [1, 1], [4], [1], [1]], cols: [[5], [1, 1], [1, 1], [3], []], givens: [] };

test('wrong fill and wrong dot', () => {
  const ref = solve(P5).reference!;
  const marks = M('#####/...../...../...../.....'); // cell 4 wrong
  const m = findMistakes(P5, marks, ref);
  expect(m.cells).toEqual([4]);
  expect(m.byRow[0]).toBe(1);
  expect(m.byCol[4]).toBe(1);
});
test('wrong dot', () => {
  const m = findMistakes(P5, M('x..../...../...../...../...x#'), solve(P5).reference!);
  expect(m).toEqual({ cells: [0, 24], byRow: [1, 0, 0, 0, 1], byCol: [1, 0, 0, 0, 1] });
});
test('dot on a given is a mistake', () => {
  const p = { ...P5, givens: [0] };
  expect(findMistakes(p, M('x..../...../...../...../.....'), solve(p).reference!).cells).toEqual([0]);
});
test('unknown reference cells are never mistakes', () => {
  const p = { width: 2, height: 2, rows: [[1], [1]], cols: [[1], [1]], givens: [] };
  const r = solve(p);
  expect(findMistakes(p, M('#x/x#'), r.reference!).cells).toEqual([]);
});
