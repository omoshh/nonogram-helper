import { describe, expect, it } from 'vitest';
import { EMPTY, FILLED, UNKNOWN } from '../../src/core/types';
import { MARK_PX, readMarks } from '../../src/vision/marks';
import type { GrayImage } from '../../src/vision/types';

const N = MARK_PX;
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5; // -0.5..0.5

type Kind = 'blank' | 'dot' | 'filled' | 'mid';

function patch(kind: Kind, o: { digit?: boolean; shift?: number } = {}): GrayImage {
  const shift = o.shift ?? 0;
  const data = new Uint8Array(N * N);
  const put = (x: number, y: number, v: number) => { data[y * N + x] = Math.max(0, Math.min(255, v + shift)); };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = N / 2 - 0.5;
      const r = Math.hypot(x - c, y - c);
      let v = 230 + rnd() * 16;
      if (kind === 'filled') v = 110 + rnd() * 50;
      if (kind === 'dot' && r <= 3) v = 60;
      if (kind === 'mid' && r <= 7) v = 60;
      put(x, y, v);
    }
  }
  if (o.digit) {
    // a "7": 1-px top bar and a diagonal, 12 px tall, off-centre
    for (let x = 14; x < 20; x++) put(x, 3, 0);
    for (let i = 0; i < 11; i++) put(19 - Math.floor(i / 2), 4 + i, 0);
  }
  return { width: N, height: N, data };
}

const many = (kind: Kind, n: number, o = {}) => Array.from({ length: n }, () => patch(kind, o));
const grid = (shift: number) => ({
  patches: [...many('blank', 60, { shift }), ...many('dot', 30, { shift }), ...many('filled', 30, { shift })],
  expected: [...Array(60).fill(UNKNOWN), ...Array(30).fill(EMPTY), ...Array(30).fill(FILLED)],
});

describe('readMarks', () => {
  for (const [name, shift] of [['normal', 0], ['dark paper', -40]] as const) {
    it(`reads 60 blank + 30 dot + 30 filled exactly (${name})`, () => {
      const { patches, expected } = grid(shift);
      const r = readMarks(patches, new Set());
      expect(Array.from(r.cells)).toEqual(expected);
      expect(r.unsure).toEqual([]);
    });
  }

  it('ignores printed digits on blank and filled cells', () => {
    const { patches, expected } = grid(0);
    const ps = [...patches, patch('blank', { digit: true }), patch('filled', { digit: true })];
    const r = readMarks(ps, new Set());
    expect(r.cells[120]).toBe(UNKNOWN);
    expect(r.cells[121]).toBe(FILLED);
    expect(Array.from(r.cells.slice(0, 120))).toEqual(expected);
  });

  it('dot + digit is EMPTY or unsure', () => {
    const { patches } = grid(0);
    const r = readMarks([...patches, patch('dot', { digit: true })], new Set());
    expect(r.cells[120] === EMPTY || r.unsure.includes(120)).toBe(true);
  });

  it('givens are FILLED and never unsure, even on a white patch', () => {
    const { patches } = grid(0);
    const r = readMarks(patches, new Set([0, 1]));
    expect(r.cells[0]).toBe(FILLED);
    expect(r.cells[1]).toBe(FILLED);
    expect(r.unsure).not.toContain(0);
    expect(r.cells[2]).toBe(UNKNOWN);
  });

  it('a patch half-way between dot and filled is unsure', () => {
    const { patches } = grid(0);
    const r = readMarks([...patches, patch('mid')], new Set());
    expect(r.unsure).toContain(120);
  });

  it('an all-blank grid stays all UNKNOWN with nothing unsure', () => {
    const r = readMarks(many('blank', 100), new Set());
    expect(Array.from(r.cells)).toEqual(Array(100).fill(UNKNOWN));
    expect(r.unsure).toEqual([]);
  });
});
