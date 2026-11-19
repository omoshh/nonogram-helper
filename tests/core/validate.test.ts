import { validate, issueLines } from '../../src/core/validate';
import type { Puzzle } from '../../src/core/types';

const ok: Puzzle = { width: 3, height: 2, rows: [[2], [1, 1]], cols: [[2], [1], [1]], givens: [] };
test('valid puzzle', () => expect(validate(ok)).toEqual([]));
test('sum mismatch', () =>
  expect(validate({ ...ok, cols: [[2], [1], []] })).toContainEqual({ kind: 'sum-mismatch', rowSum: 4, colSum: 3 }));
test('line too long', () =>
  expect(validate({ ...ok, rows: [[2, 1], [1]] })).toContainEqual(
    { kind: 'line-too-long', line: { axis: 'row', index: 0 }, need: 4, length: 3 }));
test('given conflicts with an empty row', () =>
  expect(validate({ ...ok, rows: [[], [1, 1]], cols: [[1], [], [1]], givens: [1] }))
    .toContainEqual({ kind: 'given-conflict', line: { axis: 'row', index: 0 } }));
test('empty lines are valid', () =>
  expect(validate({ width: 2, height: 2, rows: [[], [2]], cols: [[1], [1]], givens: [] })).toEqual([]));
test('issueLines dedupes, keeps order, skips sum-mismatch', () => {
  const r0 = { axis: 'row', index: 0 } as const;
  const c1 = { axis: 'col', index: 1 } as const;
  expect(issueLines([
    { kind: 'sum-mismatch', rowSum: 1, colSum: 2 },
    { kind: 'line-too-long', line: r0, need: 4, length: 3 },
    { kind: 'given-conflict', line: c1 },
    { kind: 'given-conflict', line: r0 },
  ])).toEqual([r0, c1]);
});
test('too-long line does not also report given-conflict', () =>
  expect(validate({ ...ok, rows: [[2, 1], [1]], givens: [0] }).filter(i => i.kind === 'given-conflict'
    && i.line.axis === 'row' && i.line.index === 0)).toEqual([]));
