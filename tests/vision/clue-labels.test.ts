import { validate } from '../../src/core/validate';
import { solve } from '../../src/core/solver';
import { PHOTOS, PUZZLES } from './photos';

// Clue labels for the training puzzles: no photos needed, so these run in CI.
describe('clue labels', () => {
  it('every main-journal photo names a puzzle of its size', () => {
    for (const p of PHOTOS.filter((p) => p.journal === 'main')) {
      const z = PUZZLES[p.puzzle!];
      expect(z, p.file).toBeDefined();
      expect([z.width, z.height], p.file).toEqual([p.width, p.height]);
    }
  });

  for (const [id, p] of Object.entries(PUZZLES)) {
    it(`${id} is consistent`, () => {
      expect(p.rows.length).toBe(p.height);
      expect(p.cols.length).toBe(p.width);
      if (!p.labelNote) expect(p.label).toBe(`${p.width}x${p.height}`);
      expect(validate(p)).toEqual([]);
    });

    it(`${id} solves uniquely`, () => {
      expect(solve(p, { timeLimitMs: 20000 }).status).toBe(p.nonUnique ? 'multiple' : 'unique');
    }, 60_000);
  }
});
