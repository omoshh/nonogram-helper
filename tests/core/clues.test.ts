import { parseClueLine, formatClueLine } from '../../src/core/clues';
import { lineCells, allLines } from '../../src/core/types';

test('separators from the phone keypad', () => {
  expect(parseClueLine('3 1 2')).toEqual([3, 1, 2]);
  expect(parseClueLine('3.1.2')).toEqual([3, 1, 2]);
  expect(parseClueLine('3,1,2')).toEqual([3, 1, 2]);
  expect(parseClueLine('  3  1-2 ')).toEqual([3, 1, 2]);
  expect(parseClueLine('10 2')).toEqual([10, 2]);
});
test('empty line', () => {
  expect(parseClueLine('')).toEqual([]);
  expect(parseClueLine('   ')).toEqual([]);
  expect(parseClueLine('0')).toEqual([]);
});
test('invalid', () => {
  expect(parseClueLine('3 0 2')).toBeNull();
  expect(parseClueLine('3a')).toBeNull();
});
test('format', () => {
  expect(formatClueLine([3, 1, 2])).toBe('3 1 2');
  expect(formatClueLine([])).toBe('');
});
test('line helpers', () => {
  const p = { width: 3, height: 2 };
  expect(lineCells(p, { axis: 'row', index: 1 })).toEqual([3, 4, 5]);
  expect(lineCells(p, { axis: 'col', index: 2 })).toEqual([2, 5]);
  expect(allLines(p).length).toBe(5);
});
