import { UNKNOWN, FILLED, EMPTY, type Cell, type Puzzle, type LineRef, allLines, lineCells, lineClues } from './types';
import { solveLine } from './line';
import { hasSolution, propagate } from './solver';

export type Hint =
  | { kind: 'line'; line: LineRef; cells: number[]; values: Cell[] }
  | { kind: 'probe'; cell: number; value: Cell; contradiction: LineRef } // assuming the opposite of `value` breaks `contradiction`
  | { kind: 'reveal'; cell: number; value: Cell }
  | { kind: 'conflict'; cells: number[] } // no solution fits the marks; `cells` = marks on ambiguous cells
  | { kind: 'ambiguous'; cells: number[] } // only cells the clues do not decide are left
  | { kind: 'done' };

/** The next step from a mistake-free state: a line, then an assumption, then a plain reveal. */
export function nextHint(p: Puzzle, marks: Uint8Array, reference: Uint8Array): Hint {
  const known = marks.slice();
  for (const i of p.givens) known[i] = FILLED;
  const cellsWhere = (test: (i: number) => boolean) => [...known.keys()].filter(test);
  // With a non-unique reference, marks on ambiguous cells can each be allowed yet fit no solution together.
  const conflict = (): Hint =>
    ({ kind: 'conflict', cells: cellsWhere((i) => marks[i] !== UNKNOWN && reference[i] === UNKNOWN) });
  const agrees = (cell: number, value: number) => reference[cell] === UNKNOWN || reference[cell] === value;

  if (reference.includes(UNKNOWN) && hasSolution(p, known) === false) return conflict();
  const done = reference.every((v, i) => (v === UNKNOWN ? known[i] !== UNKNOWN : v !== FILLED || known[i] === FILLED));
  if (done) return { kind: 'done' };

  // allLines() lists rows first, so keeping the first maximum breaks ties as required.
  let best: Extract<Hint, { kind: 'line' }> | null = null;
  for (const line of allLines(p)) {
    const cells = lineCells(p, line);
    const out = solveLine(lineClues(p, line), Uint8Array.from(cells, (c) => known[c]));
    if (!out) continue;
    const newCells = cells.filter((c, k) => known[c] === UNKNOWN && out[k] !== UNKNOWN);
    if (newCells.length > (best?.cells.length ?? 0)) {
      best = { kind: 'line', line, cells: newCells, values: newCells.map((c) => out[cells.indexOf(c)] as Cell) };
    }
  }
  // Backstop for when hasSolution timed out: never contradict the reference.
  if (best) return best.cells.every((c, k) => agrees(c, best.values[k])) ? best : conflict();

  for (let cell = 0; cell < known.length; cell++) {
    if (known[cell] !== UNKNOWN || reference[cell] === UNKNOWN) continue;
    for (const assumed of [FILLED, EMPTY]) {
      const grid = known.slice();
      grid[cell] = assumed;
      const r = propagate(p, grid);
      if (r.ok) continue;
      const value = assumed === FILLED ? EMPTY : FILLED;
      return agrees(cell, value) ? { kind: 'probe', cell, value, contradiction: r.line } : conflict();
    }
  }

  const cell = known.findIndex((v, i) => v === UNKNOWN && reference[i] !== UNKNOWN);
  if (cell !== -1) return { kind: 'reveal', cell, value: reference[cell] as Cell };
  return { kind: 'ambiguous', cells: cellsWhere((i) => known[i] === UNKNOWN) };
}
