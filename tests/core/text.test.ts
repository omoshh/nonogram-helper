import { mistakesText, hintText } from '../../src/core/text';
import { FILLED, EMPTY, type Puzzle } from '../../src/core/types';

const P5: Puzzle = { width: 5, height: 5,
  rows: [[4], [1, 1], [4], [1], [1]], cols: [[5], [1, 1], [1, 1], [3], []], givens: [] };
const P12: Puzzle = { width: 12, height: 8, rows: Array(8).fill([]), cols: Array(12).fill([]), givens: [] };

test('mistakes level 1', () => {
  expect(mistakesText(P5, { cells: [], byRow: [0, 0, 0, 0, 0], byCol: [0, 0, 0, 0, 0] }, 1)).toBe('No mistakes.');
  expect(mistakesText(P5, { cells: [4], byRow: [1, 0, 0, 0, 0], byCol: [0, 0, 0, 0, 1] }, 1)).toBe('1 mistake.');
  expect(mistakesText(P5, { cells: [4, 9], byRow: [1, 1, 0, 0, 0], byCol: [0, 0, 0, 0, 2] }, 1)).toBe('2 mistakes.');
});
test('mistakes level 2', () => {
  const byRow = [0, 0, 0, 2, 0, 0, 1, 0];
  const byCol = [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 2];
  expect(mistakesText(P12, { cells: [38, 47, 83], byRow, byCol }, 2)).toBe('Rows: 4 (2), 7 (1). Columns: 3 (1), 12 (2).');
  expect(mistakesText(P5, { cells: [], byRow: [0, 0, 0, 0, 0], byCol: [0, 0, 0, 0, 0] }, 2)).toBe('No mistakes.');
});

const rowHint = { kind: 'line' as const, line: { axis: 'row' as const, index: 3 }, cells: [17, 18], values: [EMPTY, EMPTY] as (1 | 2)[] };
test('line hint texts', () => {
  expect(hintText(P5, rowHint, 1)).toBe('Look at row 4.');
  expect(hintText(P5, rowHint, 2)).toBe('Row 4: columns 3–4 are empty.');
  expect(hintText(P5, rowHint, 3))
    .toBe('Row 4 (1): with the cells you have already marked, every possible placement of the blocks gives these cells.');
  const mixed = { ...rowHint, cells: [37, 38, 39, 42, 43], values: [FILLED, EMPTY, EMPTY, EMPTY, FILLED] as (1 | 2)[] };
  expect(hintText(P12, { ...mixed, cells: [38, 42, 43] , values: [FILLED, EMPTY, EMPTY] }, 2))
    .toBe('Row 4: column 3 is filled, columns 7–8 are empty.');
  expect(hintText(P12, mixed, 2)).toBe('Row 4: column 2 is filled, columns 3–4 are empty, column 7 is empty, column 8 is filled.');
});
test('line hint texts on a column', () => {
  const h = { kind: 'line' as const, line: { axis: 'col' as const, index: 3 }, cells: [15, 23, 27],
    values: [FILLED, EMPTY, EMPTY] as (1 | 2)[] };
  const p = { ...P12, width: 4, cols: [[], [], [], [3, 1, 2]] };
  expect(hintText(p, h, 1)).toBe('Look at column 4.');
  expect(hintText(p, h, 2)).toBe('Column 4: row 4 is filled, rows 6–7 are empty.');
  expect(hintText(p, h, 3))
    .toBe('Column 4 (3 1 2): with the cells you have already marked, every possible placement of the blocks gives these cells.');
});
test('probe texts', () => {
  const h = { kind: 'probe' as const, cell: 2 * 12 + 4, value: EMPTY as 2, contradiction: { axis: 'col' as const, index: 8 } };
  expect(hintText(P12, h, 1)).toBe('Look at row 3, column 5.');
  expect(hintText(P12, h, 2)).toBe('Row 3, column 5 is empty.');
  expect(hintText(P12, h, 3)).toBe('If row 3, column 5 were filled, column 9 would have no valid placement.');
  const f = { kind: 'probe' as const, cell: 0, value: FILLED as 1, contradiction: { axis: 'row' as const, index: 1 } };
  expect(hintText(P12, f, 2)).toBe('Row 1, column 1 is filled.');
  expect(hintText(P12, f, 3)).toBe('If row 1, column 1 were empty, row 2 would have no valid placement.');
});
test('reveal and done texts', () => {
  const h = { kind: 'reveal' as const, cell: 2 * 12 + 4, value: FILLED as 1 };
  expect(hintText(P12, h, 1)).toBe('Single lines and single assumptions do not help here.');
  expect(hintText(P12, h, 2)).toBe('The solution has row 3, column 5 filled.');
  expect(hintText(P12, h, 3)).toBe('The solution has row 3, column 5 filled.');
  expect(hintText(P12, { ...h, value: EMPTY }, 2)).toBe('The solution has row 3, column 5 empty.');
  for (const level of [1, 2, 3] as const) {
    expect(hintText(P12, { kind: 'done' }, level)).toBe('All filled cells are marked. The puzzle is solved.');
  }
});
test('line hint level 3 on a line without blocks', () => {
  const h = { kind: 'line' as const, line: { axis: 'col' as const, index: 4 }, cells: [4], values: [EMPTY] as (1 | 2)[] };
  expect(hintText(P5, h, 3))
    .toBe('Column 5 (0): with the cells you have already marked, every possible placement of the blocks gives these cells.');
});
