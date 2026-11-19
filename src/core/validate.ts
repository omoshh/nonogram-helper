import { FILLED, UNKNOWN, allLines, lineCells, lineClues } from './types';
import type { LineRef, Puzzle } from './types';
import { solveLine } from './line';

export type Issue =
  | { kind: 'sum-mismatch'; rowSum: number; colSum: number }
  | { kind: 'line-too-long'; line: LineRef; need: number; length: number } // need = sum + count - 1
  | { kind: 'given-conflict'; line: LineRef };

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function validate(p: Puzzle): Issue[] {
  const issues: Issue[] = [];
  const rowSum = p.rows.reduce((a, r) => a + sum(r), 0);
  const colSum = p.cols.reduce((a, c) => a + sum(c), 0);
  if (rowSum !== colSum) issues.push({ kind: 'sum-mismatch', rowSum, colSum });

  const given = new Set(p.givens);
  for (const line of allLines(p)) {
    const clues = lineClues(p, line);
    const cells = lineCells(p, line);
    const need = sum(clues) + Math.max(clues.length - 1, 0);
    if (need > cells.length) {
      issues.push({ kind: 'line-too-long', line, need, length: cells.length });
      continue;
    }
    const cur = Uint8Array.from(cells, (i) => (given.has(i) ? FILLED : UNKNOWN));
    if (solveLine(clues, cur) === null) issues.push({ kind: 'given-conflict', line });
  }
  return issues;
}

export function issueLines(issues: Issue[]): LineRef[] {
  const seen = new Set<string>();
  const out: LineRef[] = [];
  for (const i of issues) {
    if (i.kind === 'sum-mismatch') continue;
    const key = `${i.line.axis}${i.line.index}`;
    if (!seen.has(key)) { seen.add(key); out.push(i.line); }
  }
  return out;
}
