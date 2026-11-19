import { it, expect, vi } from 'vitest';
import type { GrayImage } from '../../src/vision/types';

// locate hands detect a collinear quad: detect must answer ok:false, not throw
vi.mock('../../src/vision/locate', () => ({
  locateTable: () => ({ ok: true, value: { rotation: 0, quad: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 200 }, { x: 300, y: 300 }], ms: 0 } }),
}));

it('detect: degenerate quad from locate -> ok:false, no throw', async () => {
  const { detect } = await import('../../src/vision/mesh');
  const img: GrayImage = { width: 400, height: 400, data: new Uint8Array(400 * 400).fill(255) };
  expect(detect(img)).toEqual({ ok: false, reason: 'no-lattice', rotation: 0 });
});
