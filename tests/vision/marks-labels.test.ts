import { describe, it, expect } from 'vitest';
import { MARK_LABELS, MARK_ROWS } from './marks-labels';

describe('mark labels (no photos needed)', () => {
  it('has 8 labels', () => expect(MARK_LABELS).toHaveLength(8));

  MARK_LABELS.forEach((l, i) => {
    it(`${MARK_ROWS[i].photo}: height rows of width chars #.-G?`, () => {
      expect(l.photo).toBeDefined();
      expect(MARK_ROWS[i].rows).toHaveLength(l.photo.height);
      for (const r of MARK_ROWS[i].rows) expect(r).toHaveLength(l.photo.width);
      expect(l.cells).toMatch(/^[#.\-G?]*$/);
    });
  });

  it('25×40 set: givens identical in all three files', () => {
    const set = MARK_LABELS.filter((l) => l.photo.file.startsWith('solved-pair/25x40-'));
    expect(set).toHaveLength(3);
    const givens = set.map((l) => [...l.cells].map((c) => (c === 'G' ? 'G' : ' ')).join(''));
    expect(givens[0]).toContain('G');
    expect(givens[1]).toBe(givens[0]);
    expect(givens[2]).toBe(givens[0]);
  });
});
