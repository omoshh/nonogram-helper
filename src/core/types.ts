export const UNKNOWN = 0, FILLED = 1, EMPTY = 2;
export type Cell = 0 | 1 | 2;

export interface Puzzle {
  width: number;
  height: number;
  rows: number[][];
  cols: number[][];
  givens: number[]; // cell indices
}

export type LineRef = { axis: 'row' | 'col'; index: number };

type Size = Pick<Puzzle, 'width' | 'height'>;

/** Cell indices of a line, left to right / top to bottom. */
export function lineCells(p: Size, ref: LineRef): number[] {
  if (ref.axis === 'row') {
    return Array.from({ length: p.width }, (_, c) => ref.index * p.width + c);
  }
  return Array.from({ length: p.height }, (_, r) => r * p.width + ref.index);
}

/** All rows, then all columns. */
export function allLines(p: Size): LineRef[] {
  const lines: LineRef[] = [];
  for (let i = 0; i < p.height; i++) lines.push({ axis: 'row', index: i });
  for (let i = 0; i < p.width; i++) lines.push({ axis: 'col', index: i });
  return lines;
}

export function lineClues(p: Puzzle, ref: LineRef): number[] {
  return (ref.axis === 'row' ? p.rows : p.cols)[ref.index];
}
