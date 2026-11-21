import { describe, it, expect } from 'vitest';
import { MARK_LABELS, MARK_ROWS } from './marks-labels';

describe('mark labels (no photos needed)', () => {
  it('has 21 labels', () => expect(MARK_LABELS).toHaveLength(21));

  MARK_LABELS.forEach((l, i) => {
    it(`${MARK_ROWS[i].photo}: height rows of width chars #.-G?`, () => {
      expect(l.photo).toBeDefined();
      expect(MARK_ROWS[i].rows).toHaveLength(l.photo.height);
      for (const r of MARK_ROWS[i].rows) expect(r).toHaveLength(l.photo.width);
      expect(l.cells).toMatch(/^[#.\-G?]*$/);
    });
  });

  for (const [set, n] of [['25x40', 3], ['25x35', 5]] as const) {
    it(`${set} set: givens identical in all ${n} files`, () => {
      const files = MARK_LABELS.filter((l) => l.photo.file.startsWith(`solved-pair/${set}-`));
      expect(files).toHaveLength(n);
      const givens = files.map((l) => [...l.cells].map((c) => (c === 'G' ? 'G' : ' ')).join(''));
      expect(givens[0]).toContain('G');
      for (const g of givens) expect(g).toBe(givens[0]);
    });
  }
});
