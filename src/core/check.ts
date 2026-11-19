import { UNKNOWN, type Puzzle } from './types';

export interface Mistakes {
  cells: number[];
  byRow: number[]; // byRow[r] = count in row r
  byCol: number[];
}

/** A mark that contradicts a known reference cell (a dot on a given included). */
export function findMistakes(p: Puzzle, marks: Uint8Array, reference: Uint8Array): Mistakes {
  const m: Mistakes = { cells: [], byRow: Array(p.height).fill(0), byCol: Array(p.width).fill(0) };
  for (let i = 0; i < marks.length; i++) {
    if (marks[i] === UNKNOWN || reference[i] === UNKNOWN || marks[i] === reference[i]) continue;
    m.cells.push(i);
    m.byRow[Math.floor(i / p.width)]++;
    m.byCol[i % p.width]++;
  }
  return m;
}
