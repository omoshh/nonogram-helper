import { describe, expect, it } from 'vitest';
import { EMPTY, FILLED, UNKNOWN } from '../../src/core/types';
import { MARK_PX, readMarks } from '../../src/vision/marks';
import type { GrayImage } from '../../src/vision/types';

const N = MARK_PX;
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5; // -0.5..0.5

type Digit = '7' | '1' | '0';
type Kind = 'blank' | 'dot' | 'filled' | 'mid';

function patch(kind: Kind, o: { digit?: Digit; shift?: number } = {}): GrayImage {
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
  // Real photos print the region number in the cell's bottom-right corner, cut by the patch edge.
  if (o.digit === '1') for (let y = 12; y < N; y++) put(21, y, 0);
  if (o.digit === '0') {
    for (let y = 12; y < N; y++) for (let x = 17; x < N; x++) {
      const e = ((x - 21) / 4) ** 2 + ((y - 18) / 6) ** 2;
      if (e <= 1 && e > 0.4) put(x, y, 0);
    }
  }
  if (o.digit === '7') {
    // a "7": 1-px top bar and a diagonal, 12 px tall, down to the bottom edge
    for (let x = 18; x < N; x++) put(x, 12, 0);
    for (let i = 0; i < 11; i++) put(23 - Math.floor(i / 2), 13 + i, 0);
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
      const r = readMarks(patches, new Set(), patches.length);
      expect(Array.from(r.cells)).toEqual(expected);
      expect(r.unsure).toEqual([]);
    });
  }

  it('ignores printed digits on blank and filled cells', () => {
    const { patches, expected } = grid(0);
    const ps = [...patches, patch('blank', { digit: '7' }), patch('filled', { digit: '7' })];
    const r = readMarks(ps, new Set(), ps.length);
    expect(r.cells[120]).toBe(UNKNOWN);
    expect(r.cells[121]).toBe(FILLED);
    expect(Array.from(r.cells.slice(0, 120))).toEqual(expected);
  });

  for (const d of ['1', '0'] as const) {
    it(`ignores a printed "${d}" on blank and filled cells`, () => {
      const { patches, expected } = grid(0);
      const r = readMarks([...patches, patch('blank', { digit: d }), patch('filled', { digit: d })], new Set(), patches.length + 2);
      expect(r.cells[120]).toBe(UNKNOWN);
      expect(r.cells[121]).toBe(FILLED);
      expect(Array.from(r.cells.slice(0, 120))).toEqual(expected);
      expect(r.unsure).toEqual([]);
    });
  }

  it('dot + digit is EMPTY or unsure', () => {
    const { patches } = grid(0);
    const r = readMarks([...patches, patch('dot', { digit: '7' })], new Set(), patches.length + 1);
    expect(r.cells[120] === EMPTY || r.unsure.includes(120)).toBe(true);
  });

  it('givens are FILLED and never unsure, even on a white patch', () => {
    const { patches } = grid(0);
    const r = readMarks(patches, new Set([0, 1]), patches.length);
    expect(r.cells[0]).toBe(FILLED);
    expect(r.cells[1]).toBe(FILLED);
    expect(r.unsure).not.toContain(0);
    expect(r.cells[2]).toBe(UNKNOWN);
  });

  it('a patch half-way between dot and filled is unsure', () => {
    const { patches } = grid(0);
    const r = readMarks([...patches, patch('mid')], new Set(), patches.length + 1);
    expect(r.unsure).toContain(120);
  });

  it('a strong dot on a cell dark enough to be filled is unsure, never a silent dot', () => {
    const { patches } = grid(0);
    const grey = patch('dot');
    for (let k = 0; k < N * N; k++) if (grey.data[k] > 100) grey.data[k] = 203; // uniform grey: fill score past the cut
    patches.splice(30, 0, grey); // among blanks, so its local paper is white
    const r = readMarks(patches, new Set(), patches.length);
    expect(r.unsure).toContain(30);
    expect(r.overrides).toBe(1);
  });

  const shade = (p: GrayImage, k: number) => { for (let j = 0; j < p.data.length; j++) p.data[j] = Math.round(p.data[j] * k); return p; };

  it('a shadow over blank cells of an empty grid is unsure, never a silent fill', () => {
    const ps = many('blank', 100);
    for (let i = 90; i < 100; i++) shade(ps[i], 0.6 + 0.03 * (i - 90)); // a ramp into the corner
    const r = readMarks(ps, new Set(), 10);
    for (let i = 90; i < 100; i++) expect(r.cells[i] !== FILLED || r.unsure.includes(i)).toBe(true);
    expect(r.retake).toBe(true);
  });

  it('dots in a deep shadow are unsure, never silent fills', () => {
    const { patches } = grid(0);
    const ps = [...patches, ...many('dot', 5).map((p) => shade(p, 0.4))];
    const r = readMarks(ps, new Set(), ps.length);
    for (let i = 120; i < 125; i++) expect(r.cells[i] !== FILLED || r.unsure.includes(i)).toBe(true);
  });

  it('a faint centred dot is unsure, not a sure blank', () => {
    const { patches } = grid(0);
    const faint = patch('blank');
    for (let y = 9; y < 15; y++) for (let x = 9; x < 15; x++) faint.data[y * N + x] = 210; // ~0.09 contrast
    const r = readMarks([...patches, faint], new Set(), patches.length + 1);
    expect(r.unsure).toContain(120);
  });

  it('retake is false when unsure stays within 1 % of the cells', () => {
    const { patches } = grid(0);
    expect(readMarks(patches, new Set(), patches.length).retake).toBe(false);
  });

  it('an all-blank grid stays all UNKNOWN with nothing unsure', () => {
    const r = readMarks(many('blank', 100), new Set(), 100);
    expect(Array.from(r.cells)).toEqual(Array(100).fill(UNKNOWN));
    expect(r.unsure).toEqual([]);
  });
});
