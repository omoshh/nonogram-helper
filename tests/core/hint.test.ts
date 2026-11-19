import { readFileSync } from 'node:fs';
import { nextHint } from '../../src/core/hint';
import { solve, hasSolution } from '../../src/core/solver';
import { findMistakes } from '../../src/core/check';
import { UNKNOWN, FILLED, EMPTY, type Puzzle } from '../../src/core/types';

/** Marks from rows joined by '/': '#' filled, 'x' empty, '.' unknown. */
const M = (s: string) =>
  Uint8Array.from([...s.replaceAll('/', '')], (ch) => (ch === '#' ? FILLED : ch === 'x' ? EMPTY : UNKNOWN));

// solution ####x/#xx#x/####x/#xxxx/#xxxx
const P5: Puzzle = { width: 5, height: 5,
  rows: [[4], [1, 1], [4], [1], [1]], cols: [[5], [1, 1], [1, 1], [3], []], givens: [] };

test('line hint picks the line with most new cells', () => {
  const h = nextHint(P5, M('...../...../...../...../.....'), solve(P5).reference!);
  // col 0 ([5]) and col 4 ([]) both force 5 cells; tie → lower index
  expect(h).toEqual({ kind: 'line', line: { axis: 'col', index: 0 }, cells: [0, 5, 10, 15, 20],
    values: [FILLED, FILLED, FILLED, FILLED, FILLED] });
});
test('line hint: rows before columns on a tie', () => {
  // col 0 and col 4 known; rows 0 and 2 ([4]) and col 3 ([3]) each give 3 new cells
  const h = nextHint(P5, M('#...x/#...x/#...x/#...x/#...x'), solve(P5).reference!);
  expect(h).toEqual({ kind: 'line', line: { axis: 'row', index: 0 }, cells: [1, 2, 3],
    values: [FILLED, FILLED, FILLED] });
});
test('givens count as filled', () => {
  const p = { ...P5, givens: [0, 5, 10, 15, 20] };
  const h = nextHint(p, M('...../...../...../...../.....'), solve(p).reference!);
  expect(h).toMatchObject({ kind: 'line', line: { axis: 'col', index: 4 } });
});
test('done', () => {
  const ref = solve(P5).reference!;
  expect(nextHint(P5, Uint8Array.from(ref.map((v) => (v === FILLED ? FILLED : UNKNOWN))), ref))
    .toEqual({ kind: 'done' });
});
test('done counts givens', () => {
  const p = { ...P5, givens: [0] };
  expect(nextHint(p, M('.###x/#xx#x/####x/#xxxx/#xxxx'), solve(p).reference!)).toEqual({ kind: 'done' });
});

// Unique 5×5 solution #x#xx/xx##x/xx#x#/xxxx#/##x#x. From an empty grid, line logic stops at
// .x.x./xx.#./.x#x./.x.../.#... with no line giving a new cell.
const STUCK: Puzzle = { width: 5, height: 5,
  rows: [[1, 1], [2], [1, 1], [1], [2, 1]], cols: [[1, 1], [1], [3], [1, 1], [2]], givens: [] };
test('probe when lines are stuck', () => {
  const h = nextHint(STUCK, M('.x.x./xx.#./.x#x./.x.../.#...'), solve(STUCK).reference!);
  // Cell 0 filled breaks nothing; cell 0 empty forces row 0 to xx#x# and propagation then breaks row 2.
  expect(h).toEqual({ kind: 'probe', cell: 0, value: FILLED, contradiction: { axis: 'row', index: 1 } });
});
test('probe skips cells unknown in reference', () => {
  const ref = solve(STUCK).reference!;
  ref[0] = UNKNOWN;
  const h = nextHint(STUCK, M('.x.x./xx.#./.x#x./.x.../.#...'), ref);
  // Cell 0 is skipped; cell 2 empty forces row 0 to #xxx# and propagation then breaks column 1.
  expect(h).toEqual({ kind: 'probe', cell: 2, value: FILLED, contradiction: { axis: 'col', index: 0 } });
});
test('reveal when nothing else helps', () => {
  // 2×4: rows 2–3 hold a diagonal that can go either way. Give the reference one of the two
  // diagonals, so neither lines nor assumptions reach it.
  const p = { width: 2, height: 4, rows: [[2], [], [1], [1]], cols: [[1, 1], [1, 1]], givens: [] };
  const ref = M('##/xx/#x/x#');
  expect(nextHint(p, M('##/xx/../..'), ref)).toEqual({ kind: 'reveal', cell: 4, value: FILLED });
});
test('reveal skips cells unknown in reference', () => {
  const p = { width: 2, height: 4, rows: [[2], [], [1], [1]], cols: [[1, 1], [1, 1]], givens: [] };
  const ref = M('##/xx/.x/x#');
  expect(nextHint(p, M('##/xx/../..'), ref)).toEqual({ kind: 'reveal', cell: 5, value: EMPTY });
});
test('j37 with empty marks is fast', () => {
  const p: Puzzle = JSON.parse(readFileSync('tests/fixtures/puzzles/j37-25x35.json', 'utf8'));
  const ref = solve(p).reference!;
  const t = performance.now();
  const h = nextHint(p, new Uint8Array(p.width * p.height), ref);
  expect(performance.now() - t).toBeLessThan(1000);
  expect(h.kind).toBe('line');
});

// --- non-unique reference ---

test('conflict: each mark is allowed, together they fit no solution', () => {
  const p: Puzzle = { width: 3, height: 4, rows: [[1], [2], [], [1]], cols: [[1], [1], [1, 1]], givens: [] };
  const ref = solve(p).reference!;
  expect([...ref]).toEqual([...M('.x./.#./xxx/xx#')]);
  const marks = M('x.x/x.#/x.x/x.#');
  expect(findMistakes(p, marks, ref).cells).toEqual([]);
  expect(nextHint(p, marks, ref)).toEqual({ kind: 'conflict', cells: [0, 2, 3, 5] });
});
const DIAG4: Puzzle = { width: 2, height: 4, rows: [[2], [], [1], [1]], cols: [[1, 1], [1, 1]], givens: [] };
test('ambiguous: only undecided cells are left', () => {
  expect(nextHint(DIAG4, M('##/xx/../..'), solve(DIAG4).reference!)).toEqual({ kind: 'ambiguous', cells: [4, 5, 6, 7] });
  const diag2: Puzzle = { width: 2, height: 2, rows: [[1], [1]], cols: [[1], [1]], givens: [] };
  expect(nextHint(diag2, M('../..'), solve(diag2).reference!)).toEqual({ kind: 'ambiguous', cells: [0, 1, 2, 3] });
});
test('done with a non-unique reference needs the undecided cells marked', () => {
  const ref = solve(DIAG4).reference!;
  expect(nextHint(DIAG4, M('##/xx/x#/#x'), ref)).toEqual({ kind: 'done' });
  expect(nextHint(DIAG4, M('##/../x#/#x'), ref)).toEqual({ kind: 'done' }); // unmarked cells are reference-EMPTY
  expect(nextHint(DIAG4, M('##/xx/x./#x'), ref)).toMatchObject({ kind: 'line' });
});

// --- brute-force cross-check ---

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const runs = (cells: boolean[]) => {
  const out: number[] = [];
  let n = 0;
  for (const c of cells) {
    if (c) n++;
    else if (n) { out.push(n); n = 0; }
  }
  if (n) out.push(n);
  return out;
};
function bruteSolutions(p: Puzzle): Uint8Array[] {
  const n = p.width * p.height;
  const sols: Uint8Array[] = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    const on = (i: number) => ((mask >> i) & 1) === 1;
    if (!p.givens.every(on)) continue;
    let ok = true;
    for (let r = 0; r < p.height && ok; r++) {
      ok = runs(Array.from({ length: p.width }, (_, c) => on(r * p.width + c))).join() === p.rows[r].join();
    }
    for (let c = 0; c < p.width && ok; c++) {
      ok = runs(Array.from({ length: p.height }, (_, r) => on(r * p.width + c))).join() === p.cols[c].join();
    }
    if (ok) sols.push(Uint8Array.from({ length: n }, (_, i) => (on(i) ? FILLED : EMPTY)));
  }
  return sols;
}

test('hints agree with brute force on random small puzzles and marks', () => {
  const rnd = mulberry32(2026);
  const seen: Record<string, number> = {};
  let multiple = 0;
  for (let t = 0; t < 400; t++) {
    const width = 1 + Math.floor(rnd() * 3);
    const height = 1 + Math.floor(rnd() * 4);
    const fill = Array.from({ length: width * height }, () => rnd() < 0.5);
    const rows = Array.from({ length: height }, (_, r) => runs(fill.slice(r * width, (r + 1) * width)));
    const cols = Array.from({ length: width }, (_, c) => runs(Array.from({ length: height }, (_, r) => fill[r * width + c])));
    const givens = fill.flatMap((f, i) => (f && rnd() < 0.1 ? [i] : []));
    const p: Puzzle = { width, height, rows, cols, givens };
    const sols = bruteSolutions(p);
    const r = solve(p, { timeLimitMs: 10000 });
    expect(r.timedOut).toBe(false);
    if (sols.length > 1) multiple++;
    const ref = r.reference!;
    for (let k = 0; k < 5; k++) {
      // Mistake-free marks: known reference cells copied, undecided cells marked at random.
      const marks = ref.map((v) => (rnd() < 0.5 ? UNKNOWN : v === UNKNOWN ? (rnd() < 0.5 ? FILLED : EMPTY) : v));
      expect(findMistakes(p, marks, ref).cells).toEqual([]);
      const known = marks.slice();
      for (const i of givens) known[i] = FILLED;
      const fits = sols.filter((s) => s.every((v, i) => known[i] === UNKNOWN || known[i] === v));
      const h = nextHint(p, marks, ref);
      const label = `${JSON.stringify(p)} marks=${[...marks].join('')} hint=${JSON.stringify(h)}`;
      seen[h.kind] = (seen[h.kind] ?? 0) + 1;
      expect(h.kind === 'conflict', label).toBe(fits.length === 0);
      const forced = (cell: number, value: number) => fits.every((s) => s[cell] === value);
      if (h.kind === 'line') h.cells.forEach((c, j) => expect(forced(c, h.values[j]), label).toBe(true));
      if (h.kind === 'probe' || h.kind === 'reveal') expect(forced(h.cell, h.value), label).toBe(true);
      if (h.kind === 'done') expect(fits.length, label).toBe(1);
      if (h.kind === 'ambiguous') {
        expect(h.cells.length, label).toBeGreaterThan(0);
        for (const c of h.cells) expect(fits.some((s) => s[c] === FILLED) && fits.some((s) => s[c] === EMPTY), label).toBe(true);
      }
    }
  }
  expect(multiple).toBeGreaterThan(10);
  for (const kind of ['line', 'conflict', 'ambiguous', 'done']) expect(seen[kind], kind).toBeGreaterThan(0);
});
