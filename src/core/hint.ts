import { UNKNOWN, FILLED, EMPTY, type Cell, type Puzzle, type LineRef, allLines, lineCells, lineClues } from './types';
import { solveLine } from './line';
import { propagate } from './solver';

export type Hint =
  | { kind: 'line'; line: LineRef; cells: number[]; values: Cell[] }
  | { kind: 'probe'; cell: number; value: Cell; contradiction: LineRef } // assuming the opposite of `value` breaks `contradiction`
  | { kind: 'reveal'; cell: number; value: Cell }
  | { kind: 'done' };

/** The next step from a mistake-free state: a line, then an assumption, then a plain reveal. */
export function nextHint(p: Puzzle, marks: Uint8Array, reference: Uint8Array): Hint {
  const known = marks.slice();
  for (const i of p.givens) known[i] = FILLED;
  if (reference.every((v, i) => v !== FILLED || known[i] === FILLED)) return { kind: 'done' };

  // allLines() lists rows first, so keeping the first maximum breaks ties as required.
  let best: Hint | null = null;
  for (const line of allLines(p)) {
    const cells = lineCells(p, line);
    const out = solveLine(lineClues(p, line), Uint8Array.from(cells, (c) => known[c]));
    if (!out) continue;
    const newCells = cells.filter((c, k) => known[c] === UNKNOWN && out[k] !== UNKNOWN);
    if (newCells.length > (best?.kind === 'line' ? best.cells.length : 0)) {
      best = { kind: 'line', line, cells: newCells, values: newCells.map((c) => out[cells.indexOf(c)] as Cell) };
    }
  }
  if (best) return best;

  for (let cell = 0; cell < known.length; cell++) {
    if (known[cell] !== UNKNOWN || reference[cell] === UNKNOWN) continue;
    for (const assumed of [FILLED, EMPTY]) {
      const grid = known.slice();
      grid[cell] = assumed;
      const r = propagate(p, grid);
      if (!r.ok) return { kind: 'probe', cell, value: assumed === FILLED ? EMPTY : FILLED, contradiction: r.line };
    }
  }

  const cell = known.findIndex((v, i) => v === UNKNOWN && reference[i] !== UNKNOWN);
  return { kind: 'reveal', cell, value: reference[cell] as Cell };
}
