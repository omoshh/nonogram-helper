import { describe, it, expect } from 'vitest';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { rotate90 } from '../../src/vision/image';
import { meshFromCorners } from '../../src/vision/mesh';
import { collectSamples } from '../../src/vision/clueRead';
import { loadPhoto } from '../support/loadPhoto';
import { PHOTOS, PUZZLES } from './photos';
import { thin } from './samples';

// Writes src/vision/digit-samples.json from all clean-clue main-journal photos (blind ones excluded).
// Run: BUILD_SAMPLES=1 npx vitest run tests/vision/build-samples.test.ts
describe.skipIf(!process.env.BUILD_SAMPLES)('build digit samples', () => {
  it('writes the thinned samples, <= 200 KB', () => {
    const all = PHOTOS.filter((p) => p.journal === 'main' && !p.cluesCrossed && !p.file.includes('/blind-') && existsSync(p.file))
      .flatMap((p) => {
        const up = rotate90(loadPhoto(p.file)!, p.rotation), g = meshFromCorners(up, p.gridCorners.map(([x, y]) => ({ x, y })), p);
        const z = PUZZLES[p.puzzle!];
        return collectSamples(up, g, z.rows, z.cols, z.label).map((s) => ({ ...s, p: p.puzzle! }));
      });
    const kept = thin(all), url = new URL('../../src/vision/digit-samples.json', import.meta.url);
    writeFileSync(url, JSON.stringify(kept.map(({ d, v }) => ({ d, v }))));
    const counts: Record<string, number> = {};
    for (const s of kept) counts[s.d] = (counts[s.d] ?? 0) + 1;
    console.log(`samples ${all.length} -> ${kept.length}, ${statSync(url).size} bytes`, counts);
    expect(statSync(url).size).toBeLessThanOrEqual(200 * 1024);
  }, 600_000);
});
