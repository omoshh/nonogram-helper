import { solveLine } from '../../src/core/line';
import { UNKNOWN, FILLED, EMPTY } from '../../src/core/types';

const L = (s: string) =>
  Uint8Array.from(s, (ch) => (ch === '#' ? FILLED : ch === 'x' ? EMPTY : UNKNOWN));
const S = (a: Uint8Array) =>
  Array.from(a, (v) => (v === FILLED ? '#' : v === EMPTY ? 'x' : '.')).join('');

test('overlap', () => expect(S(solveLine([3], L('.....'))!)).toBe('..#..'));
test('full', () => expect(S(solveLine([5], L('.....'))!)).toBe('#####'));
test('two blocks exact', () => expect(S(solveLine([2, 1], L('....'))!)).toBe('##x#'));
test('no clues → all empty', () => expect(S(solveLine([], L('....'))!)).toBe('xxxx'));
test('known cell pins block', () => expect(S(solveLine([1], L('.#.'))!)).toBe('x#x'));
test('contradiction: no room', () => expect(solveLine([3], L('.x..'))).toBeNull());
test('contradiction: too many filled', () => expect(solveLine([1, 1], L('##.'))).toBeNull());
test('contradiction: filled in empty line', () => expect(solveLine([], L('.#.'))).toBeNull());
test('nothing forced', () => expect(S(solveLine([1], L('...'))!)).toBe('...'));
test('does not mutate input', () => {
  const line = L('.....');
  solveLine([3], line);
  expect(S(line)).toBe('.....');
});
test('long line is fast', () => {
  const clues = [1, 2, 1, 3, 1, 2, 1, 1, 2, 1, 1, 2];
  const t = performance.now();
  for (let i = 0; i < 1000; i++) solveLine(clues, new Uint8Array(50));
  expect(performance.now() - t).toBeLessThan(500);
});

test('edge: block pinned at the start', () => expect(S(solveLine([1], L('#....'))!)).toBe('#xxxx'));
test('edge: block pinned at the end', () => expect(S(solveLine([1], L('....#'))!)).toBe('xxxx#'));
test('edge: block longer than line', () => expect(solveLine([6], L('.....'))).toBeNull());

test('matches brute-force enumeration on seeded random lines', () => {
  let seed = 12345;
  const rnd = () => {
    // mulberry32
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (max: number) => Math.floor(rnd() * max);

  for (let it = 0; it < 2000; it++) {
    const n = 1 + int(9);
    const line = Uint8Array.from({ length: n }, () => (rnd() < 0.7 ? UNKNOWN : 1 + int(2)));
    const clues = Array.from({ length: int(5) }, () => 1 + int(4)); // may be infeasible

    const solutions: number[][] = [];
    for (let m = 0; m < 1 << n; m++) {
      const bits = Array.from({ length: n }, (_, i) => (m >> i) & 1);
      const runs: number[] = [];
      let c = 0;
      for (const b of [...bits, 0]) {
        if (b) c++;
        else if (c) {
          runs.push(c);
          c = 0;
        }
      }
      if (runs.join() !== clues.join()) continue;
      if (bits.every((b, i) => line[i] === UNKNOWN || (line[i] === FILLED) === !!b)) solutions.push(bits);
    }
    const expected = solutions.length === 0
      ? null
      : Array.from({ length: n }, (_, i) =>
          solutions.every((s) => s[i] === 1) ? FILLED : solutions.every((s) => s[i] === 0) ? EMPTY : UNKNOWN);

    const got = solveLine(clues, line);
    expect(got ? Array.from(got) : null, `clues=${clues} line=${S(line)}`).toEqual(expected);
  }
});
