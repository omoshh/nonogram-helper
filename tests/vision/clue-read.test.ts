import { describe, it, expect } from 'vitest';
import { lineFromCells, cellValue, type CellRead } from '../../src/vision/clueRead';

const sure = (...vs: (number | null)[]): CellRead[] => vs.map((value) => ({ value, sure: true }));

describe('lineFromCells', () => {
  it('right-aligned cells give the clues in order', () =>
    expect(lineFromCells(sure(null, null, 3, 12), 25)).toEqual({ clues: [3, 12], sure: true }));
  it('a gap inside the run is unsure', () => {
    expect(lineFromCells(sure(3, null, 5), 25).sure).toBe(false);
    expect(lineFromCells(sure(3, 5, null), 25).sure).toBe(false); // empty cell next to the grid
  });
  it('a 0 or a value over the line length is unsure', () => {
    expect(lineFromCells(sure(0), 25).sure).toBe(false);
    expect(lineFromCells(sure(26), 25).sure).toBe(false);
    expect(lineFromCells(sure(25), 25).sure).toBe(true);
  });
  it('one unsure cell makes the line unsure', () =>
    expect(lineFromCells([{ value: 4, sure: false }], 25)).toEqual({ clues: [4], sure: false }));
  it('no clues is an empty sure line', () =>
    expect(lineFromCells(sure(null, null, null), 25)).toEqual({ clues: [], sure: true }));
});

describe('cellValue', () => {
  it('builds the value from its digits', () => {
    expect(cellValue([])).toEqual({ value: null, sure: true });
    expect(cellValue(['7'])).toEqual({ value: 7, sure: true });
    expect(cellValue(['1', '2'])).toEqual({ value: 12, sure: true });
  });
  it('a leading zero cell is unsure', () => expect(cellValue(['0', '5'])).toEqual({ value: 5, sure: false }));
  it('a non-digit glyph is unsure', () => expect(cellValue(['x']).sure).toBe(false));
});
