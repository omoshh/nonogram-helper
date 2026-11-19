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
