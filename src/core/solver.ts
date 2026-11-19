import { UNKNOWN, FILLED, EMPTY, type Puzzle, type LineRef, allLines, lineCells, lineClues } from './types';
import { solveLine } from './line';

export interface SolveResult {
  status: 'unique' | 'multiple' | 'none';
  reference: Uint8Array | null; // unique: the solution; multiple: cells equal in ALL solutions, others UNKNOWN; none: null
  suspect: LineRef[];
  ms: number;
}

/** Lines indexed like allLines(): rows 0..h-1, then cols h..h+w-1. */
interface Lines {
  refs: LineRef[];
  cells: Int32Array[];
  clues: number[][];
  width: number;
  height: number;
}

function linesOf(p: Puzzle): Lines {
  const refs = allLines(p);
  return {
    refs,
    cells: refs.map((ref) => Int32Array.from(lineCells(p, ref))),
    clues: refs.map((ref) => lineClues(p, ref)),
    width: p.width,
    height: p.height,
  };
}

const rowOf = (L: Lines, cell: number) => Math.floor(cell / L.width);
const colOf = (L: Lines, cell: number) => L.height + (cell % L.width);

/** Line-solves the queued lines, and every line crossing a changed cell, until nothing changes.
 *  Mutates grid. Returns the index of the contradicting line, or -1. */
function run(L: Lines, grid: Uint8Array, queue: number[]): number {
  const queued = new Uint8Array(L.refs.length);
  for (const li of queue) queued[li] = 1;
  for (let head = 0; head < queue.length; head++) {
    const li = queue[head];
    queued[li] = 0;
    const cells = L.cells[li];
    const line = new Uint8Array(cells.length);
    for (let k = 0; k < cells.length; k++) line[k] = grid[cells[k]];
    const out = solveLine(L.clues[li], line);
    if (!out) return li;
    for (let k = 0; k < cells.length; k++) {
      if (line[k] !== UNKNOWN || out[k] === UNKNOWN) continue;
      grid[cells[k]] = out[k];
      const cross = li < L.height ? colOf(L, cells[k]) : rowOf(L, cells[k]);
      if (!queued[cross]) {
        queued[cross] = 1;
        queue.push(cross);
      }
    }
  }
  return -1;
}

/** Sets one cell and propagates from its two lines. Returns false on contradiction. */
function assign(L: Lines, grid: Uint8Array, cell: number, value: number): boolean {
  grid[cell] = value;
  return run(L, grid, [rowOf(L, cell), colOf(L, cell)]) === -1;
}

export function initialGrid(p: Puzzle): Uint8Array {
  const grid = new Uint8Array(p.width * p.height);
  for (const i of p.givens) grid[i] = FILLED;
  return grid;
}

/** Line-solves until nothing changes. Mutates grid. */
export function propagate(p: Puzzle, grid: Uint8Array): { ok: true } | { ok: false; line: LineRef } {
  const L = linesOf(p);
  const bad = run(L, grid, L.refs.map((_, i) => i));
  return bad === -1 ? { ok: true } : { ok: false, line: L.refs[bad] };
}

const opposite = (v: number) => (v === FILLED ? EMPTY : FILLED);

/** For each unknown cell try both values; a contradiction forces the other one. Repeats until
 *  no change. Mutates grid. Returns false if the grid has no solution. */
function probe(L: Lines, grid: Uint8Array): boolean {
  let changed = true;
  while (changed) {
    changed = false;
    for (let cell = 0; cell < grid.length; cell++) {
      if (grid[cell] !== UNKNOWN) continue;
      for (const value of [FILLED, EMPTY]) {
        if (assign(L, grid.slice(), cell, value)) continue;
        if (!assign(L, grid, cell, opposite(value))) return false;
        changed = true;
        break;
      }
    }
  }
  return true;
}

class TimeUp extends Error {}

/** Depth-first search from a propagated grid. Collects up to `limit` solutions.
 *  Throws TimeUp after the deadline. */
function search(L: Lines, grid: Uint8Array, limit: number, deadline: number, found: Uint8Array[]): void {
  // Branch on the first unknown cell of the line with the fewest unknown cells.
  let best = -1;
  let bestCount = Infinity;
  for (let li = 0; li < L.cells.length; li++) {
    let count = 0;
    for (const c of L.cells[li]) if (grid[c] === UNKNOWN) count++;
    if (count > 0 && count < bestCount) {
      best = li;
      bestCount = count;
    }
  }
  if (best === -1) {
    found.push(grid);
    return;
  }
  if (performance.now() > deadline) throw new TimeUp();
  const cell = L.cells[best].find((c) => grid[c] === UNKNOWN)!;
  for (const value of [FILLED, EMPTY]) {
    const next = grid.slice();
    if (assign(L, next, cell, value)) search(L, next, limit, deadline, found);
    if (found.length >= limit) return;
  }
}

function suspectLines(L: Lines, reference: Uint8Array): LineRef[] {
  return L.refs.filter((_, li) => L.cells[li].some((c) => reference[c] === UNKNOWN));
}

export function solve(p: Puzzle, opts: { timeLimitMs?: number } = {}): SolveResult {
  const start = performance.now();
  const deadline = start + (opts.timeLimitMs ?? 5000);
  const L = linesOf(p);
  const done = (status: SolveResult['status'], reference: Uint8Array | null, suspect: LineRef[]): SolveResult =>
    ({ status, reference, suspect, ms: performance.now() - start });

  const base = initialGrid(p);
  const bad = run(L, base, L.refs.map((_, i) => i));
  if (bad !== -1) return done('none', null, [L.refs[bad]]);
  if (!probe(L, base)) return done('none', null, []);

  const found: Uint8Array[] = [];
  try {
    search(L, base, 2, deadline, found);
  } catch (e) {
    if (!(e instanceof TimeUp)) throw e;
    // Out of time before uniqueness was settled: only the logically forced cells are safe.
    return done('multiple', base, suspectLines(L, base));
  }
  if (found.length === 0) return done('none', null, []);
  if (found.length === 1) return done('unique', found[0], []);

  const [a, b] = found;
  const reference = a.map((v, i) => (v === b[i] ? v : UNKNOWN));
  for (let cell = 0; cell < reference.length; cell++) {
    if (reference[cell] === UNKNOWN || base[cell] !== UNKNOWN) continue; // forced cells are common
    const grid = base.slice();
    if (!assign(L, grid, cell, opposite(reference[cell]))) continue;
    const other: Uint8Array[] = [];
    try {
      search(L, grid, 1, deadline, other);
    } catch (e) {
      if (!(e instanceof TimeUp)) throw e;
      // Never report a false mistake: drop every cell not yet confirmed.
      for (let c = cell; c < reference.length; c++) if (base[c] === UNKNOWN) reference[c] = UNKNOWN;
      break;
    }
    if (other.length === 0) continue;
    for (let c = 0; c < reference.length; c++) if (other[0][c] !== reference[c]) reference[c] = UNKNOWN;
  }
  return done('multiple', reference, suspectLines(L, reference));
}
