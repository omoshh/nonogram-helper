import type { Sample } from '../../src/vision/digits';

export type Tagged = Sample & { p: string }; // p = source puzzle, kept in memory only (leave-one-puzzle-out checks)

const STEP = 10; // values stored to 1 decimal (JSON size); the THINNED=1 photo check reads with these rounded values
const THIN_DIST = 1.8; // same-class samples this close add little; 468 samples, 183 KiB; 1.75 adds ~70 (> 200 KB), 1.9 drops ~100 and flags 6 more lines

const dist = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));

/** Greedy thinning in input order: keep a (rounded) sample unless a kept sample of its class lies within THIN_DIST. */
export function thin(all: Tagged[]): Tagged[] {
  const kept: Tagged[] = [];
  for (const s of all) {
    const v = s.v.map((x) => Math.round(x * STEP) / STEP);
    if (kept.every((k) => k.d !== s.d || dist(k.v, v) > THIN_DIST)) kept.push({ ...s, v });
  }
  return kept;
}
