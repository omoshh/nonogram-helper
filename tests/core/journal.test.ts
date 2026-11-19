import { readFileSync } from 'node:fs';
import { validate } from '../../src/core/validate';
import { solve } from '../../src/core/solver';

for (const name of ['j37-25x35', 'spread-50x35']) {
  test(`${name} is valid and unique, fast`, () => {
    const p = JSON.parse(readFileSync(`tests/fixtures/puzzles/${name}.json`, 'utf8'));
    expect(validate(p)).toEqual([]);
    const r = solve(p);
    expect(r.status).toBe('unique');
    expect(r.ms).toBeLessThan(2000);
  });
}
