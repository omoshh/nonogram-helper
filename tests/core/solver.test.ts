import { solve } from '../../src/core/solver';
import { UNKNOWN, FILLED, EMPTY, type Puzzle } from '../../src/core/types';

const S = (grid: Uint8Array, w: number) => {
  const rows: string[] = [];
  for (let i = 0; i < grid.length; i += w) {
    rows.push(
      Array.from(grid.subarray(i, i + w), (v) => (v === FILLED ? '#' : v === EMPTY ? 'x' : '.')).join(''),
    );
  }
  return rows.join('/');
};

// 5×5 letter "P"-like puzzle with a unique solution
const P5: Puzzle = { width: 5, height: 5,
  rows: [[4], [1, 1], [4], [1], [1]], cols: [[5], [1, 1], [1, 1], [3], []], givens: [] };
test('unique', () => {
  const r = solve(P5);
  expect(r.status).toBe('unique');
  expect(S(r.reference!, 5)).toBe('####x/#xx#x/####x/#xxxx/#xxxx');
});
test('multiple: 2×2 diagonal', () => {
  const r = solve({ width: 2, height: 2, rows: [[1], [1]], cols: [[1], [1]], givens: [] });
  expect(r.status).toBe('multiple');
  expect([...r.reference!]).toEqual([UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN]);
  expect(r.suspect).toHaveLength(4);
});
test('multiple: only the ambiguous part is unknown', () => {
  // 2×4: row 0 full, row 1 empty, rows 2–3 a diagonal that can go either way
  const r = solve({ width: 2, height: 4, rows: [[2], [], [1], [1]], cols: [[1, 1], [1, 1]], givens: [] });
  expect(r.status).toBe('multiple');
  expect([...r.reference!]).toEqual([FILLED, FILLED, EMPTY, EMPTY, UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN]);
  expect(r.suspect).toHaveLength(4); // rows 2, 3 and both columns
});
test('given decides the ambiguity', () => {
  const r = solve({ width: 2, height: 2, rows: [[1], [1]], cols: [[1], [1]], givens: [0] });
  expect(r.status).toBe('unique');
});
test('none, with suspect line', () => {
  const r = solve({ width: 2, height: 2, rows: [[2], [2]], cols: [[1], [2]], givens: [] });
  expect(r.status).toBe('none');
  expect(r.reference).toBeNull();
  expect(r.suspect.length).toBeGreaterThan(0);
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

/** All grids (as FILLED/EMPTY arrays) that satisfy the puzzle, by enumerating every filling. */
function bruteSolutions(p: Puzzle): Uint8Array[] {
  const n = p.width * p.height;
  const sols: Uint8Array[] = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    const on = (i: number) => ((mask >> i) & 1) === 1;
    if (!p.givens.every(on)) continue;
    let ok = true;
    for (let r = 0; r < p.height && ok; r++) {
      const row = Array.from({ length: p.width }, (_, c) => on(r * p.width + c));
      ok = runs(row).join() === p.rows[r].join();
    }
    for (let c = 0; c < p.width && ok; c++) {
      const col = Array.from({ length: p.height }, (_, r) => on(r * p.width + c));
      ok = runs(col).join() === p.cols[c].join();
    }
    if (ok) sols.push(Uint8Array.from({ length: n }, (_, i) => (on(i) ? FILLED : EMPTY)));
  }
  return sols;
}

test('matches brute force on random small puzzles', () => {
  const rnd = mulberry32(12345);
  const seen = { unique: 0, multiple: 0, none: 0 };
  for (let t = 0; t < 300; t++) {
    const width = 1 + Math.floor(rnd() * 4);
    const height = 1 + Math.floor(rnd() * 4);
    const density = 0.3 + rnd() * 0.4;
    const fill = Array.from({ length: width * height }, () => rnd() < density);
    const rows = Array.from({ length: height }, (_, r) =>
      runs(fill.slice(r * width, (r + 1) * width)));
    const cols = Array.from({ length: width }, (_, c) =>
      runs(Array.from({ length: height }, (_, r) => fill[r * width + c])));
    // Givens mostly from the pattern; sometimes a random cell, which may make the puzzle unsolvable.
    const givens: number[] = [];
    for (let i = 0; i < width * height; i++) {
      if (rnd() < 0.1 && (fill[i] || rnd() < 0.3)) givens.push(i);
    }
    const p: Puzzle = { width, height, rows, cols, givens };

    const sols = bruteSolutions(p);
    const r = solve(p);
    const label = JSON.stringify(p);
    if (sols.length === 0) {
      expect(r.status, label).toBe('none');
      expect(r.reference, label).toBeNull();
    } else if (sols.length === 1) {
      expect(r.status, label).toBe('unique');
      expect([...r.reference!], label).toEqual([...sols[0]]);
      expect(r.suspect, label).toEqual([]);
    } else {
      expect(r.status, label).toBe('multiple');
      const common = sols[0].map((v, i) => (sols.every((s) => s[i] === v) ? v : UNKNOWN));
      expect([...r.reference!], label).toEqual([...common]);
      const expected = new Set<string>();
      common.forEach((v, i) => {
        if (v === UNKNOWN) expected.add(`row${Math.floor(i / width)}`).add(`col${i % width}`);
      });
      const got = r.suspect.map((l) => `${l.axis}${l.index}`);
      expect(got.length, label).toBe(new Set(got).size);
      expect(new Set(got), label).toEqual(expected);
    }
    seen[r.status]++;
  }
  // The generator must actually exercise every outcome.
  expect(seen.unique).toBeGreaterThan(0);
  expect(seen.multiple).toBeGreaterThan(0);
  expect(seen.none).toBeGreaterThan(0);
});

test('out of time: keeps only the logically forced cells', () => {
  const r = solve({ width: 2, height: 4, rows: [[2], [], [1], [1]], cols: [[1, 1], [1, 1]], givens: [] },
    { timeLimitMs: 0 });
  expect(r.status).toBe('multiple');
  expect([...r.reference!]).toEqual([FILLED, FILLED, EMPTY, EMPTY, UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN]);
  expect(solve(P5, { timeLimitMs: 0 }).status).toBe('unique'); // solved by logic, no search needed
});
