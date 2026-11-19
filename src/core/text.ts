import { FILLED, type Cell, type Puzzle, type LineRef, lineClues } from './types';
import { formatClueLine } from './clues';
import type { Mistakes } from './check';
import type { Hint } from './hint';

const DONE = 'All filled cells are marked. The puzzle is solved.';
const STUCK = 'Single lines and single assumptions do not help here.';

const capital = (s: string) => s[0].toUpperCase() + s.slice(1);
const lineName = (line: LineRef) => `${line.axis === 'row' ? 'row' : 'column'} ${line.index + 1}`;
const cellName = (p: Puzzle, cell: number) => `row ${Math.floor(cell / p.width) + 1}, column ${(cell % p.width) + 1}`;
const valueName = (v: Cell) => (v === FILLED ? 'filled' : 'empty');

/** "Rows: 4 (2), 7 (1)" — only lines with mistakes, 1-based. */
function counts(label: string, byLine: number[]): string | null {
  const parts = byLine.flatMap((n, i) => (n > 0 ? [`${i + 1} (${n})`] : []));
  return parts.length ? `${label}: ${parts.join(', ')}.` : null;
}

export function mistakesText(_p: Puzzle, m: Mistakes, level: 1 | 2): string {
  const n = m.cells.length;
  if (n === 0) return 'No mistakes.';
  if (level === 1) return n === 1 ? '1 mistake.' : `${n} mistakes.`;
  return [counts('Rows', m.byRow), counts('Columns', m.byCol)].filter(Boolean).join(' ');
}

/** "column 3 is filled, columns 7–8 are empty": runs of adjacent cells with the same value. */
function lineCellsText(p: Puzzle, h: Extract<Hint, { kind: 'line' }>): string {
  const cross = h.line.axis === 'row' ? 'column' : 'row';
  const pos = (cell: number) => (h.line.axis === 'row' ? cell % p.width : Math.floor(cell / p.width)) + 1;
  const groups: { from: number; to: number; value: Cell }[] = [];
  h.cells.forEach((cell, k) => {
    const last = groups[groups.length - 1];
    if (last && last.value === h.values[k] && last.to + 1 === pos(cell)) last.to++;
    else groups.push({ from: pos(cell), to: pos(cell), value: h.values[k] });
  });
  return groups
    .map((g) => (g.from === g.to
      ? `${cross} ${g.from} is ${valueName(g.value)}`
      : `${cross}s ${g.from}–${g.to} are ${valueName(g.value)}`))
    .join(', ');
}

export function hintText(p: Puzzle, h: Hint, level: 1 | 2 | 3): string {
  switch (h.kind) {
    case 'done':
      return DONE;
    case 'line': {
      const name = lineName(h.line);
      if (level === 1) return `Look at ${name}.`;
      if (level === 2) return `${capital(name)}: ${lineCellsText(p, h)}.`;
      const clues = lineClues(p, h.line);
      const clueText = clues.length ? formatClueLine(clues) : '0';
      return `${capital(name)} (${clueText}): with the cells you have already marked, every possible placement of the blocks gives these cells.`;
    }
    case 'probe': {
      const name = cellName(p, h.cell);
      if (level === 1) return `Look at ${name}.`;
      if (level === 2) return `${capital(name)} is ${valueName(h.value)}.`;
      const assumed = h.value === FILLED ? 'empty' : 'filled';
      return `If ${name} were ${assumed}, ${lineName(h.contradiction)} would have no valid placement.`;
    }
    case 'reveal':
      return level === 1 ? STUCK : `The solution has ${cellName(p, h.cell)} ${valueName(h.value)}.`;
  }
}
