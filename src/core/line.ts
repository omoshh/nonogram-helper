import { UNKNOWN, FILLED, EMPTY } from './types';

/** Returns a new line where every cell that is the same in all valid placements is set.
 *  Known input cells are kept. Returns null if no placement fits (contradiction). */
export function solveLine(clues: number[], line: Uint8Array): Uint8Array | null {
  const n = line.length;
  const k = clues.length;
  const w = k + 1;

  // Prefix of i cells can hold the first j blocks.
  const f = new Uint8Array((n + 1) * w);
  // Suffix starting at i can hold blocks j..k-1.
  const g = new Uint8Array((n + 2) * w);

  // Can block j occupy cells s..s+len-1 (no EMPTY inside)? Prefix counts make this O(1).
  const emptyPrefix = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) emptyPrefix[i + 1] = emptyPrefix[i] + (line[i] === EMPTY ? 1 : 0);
  const fits = (s: number, len: number) =>
    s >= 0 && s + len <= n && emptyPrefix[s + len] === emptyPrefix[s];

  f[0] = 1;
  for (let i = 1; i <= n; i++) {
    for (let j = 0; j <= k; j++) {
      let ok = line[i - 1] !== FILLED && f[(i - 1) * w + j] === 1;
      if (!ok && j > 0) {
        const s = i - clues[j - 1];
        if (fits(s, clues[j - 1])) {
          ok = s === 0 ? j === 1 : line[s - 1] !== FILLED && f[(s - 1) * w + j - 1] === 1;
        }
      }
      if (ok) f[i * w + j] = 1;
    }
  }
  if (!f[n * w + k]) return null;

  g[n * w + k] = 1;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = 0; j <= k; j++) {
      let ok = line[i] !== FILLED && g[(i + 1) * w + j] === 1;
      if (!ok && j < k && fits(i, clues[j])) {
        const e = i + clues[j];
        ok = e === n ? j === k - 1 : line[e] !== FILLED && g[(e + 1) * w + j + 1] === 1;
      }
      if (ok) g[i * w + j] = 1;
    }
  }

  const canFill = new Int32Array(n + 1); // difference array
  const canEmpty = new Uint8Array(n);
  for (let j = 0; j < k; j++) {
    const len = clues[j];
    for (let s = 0; s + len <= n; s++) {
      if (!fits(s, len)) continue;
      const before = s === 0 ? j === 0 : line[s - 1] !== FILLED && f[(s - 1) * w + j] === 1;
      const e = s + len;
      const after = e === n ? j === k - 1 : line[e] !== FILLED && g[(e + 1) * w + j + 1] === 1;
      if (before && after) {
        canFill[s]++;
        canFill[e]--;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (line[i] === FILLED) continue;
    for (let j = 0; j <= k; j++) {
      if (f[i * w + j] && g[(i + 1) * w + j]) {
        canEmpty[i] = 1;
        break;
      }
    }
  }

  const out = new Uint8Array(n);
  let run = 0;
  for (let i = 0; i < n; i++) {
    run += canFill[i];
    const cf = run > 0;
    const ce = canEmpty[i] === 1;
    if (cf && ce) out[i] = UNKNOWN;
    else if (cf) out[i] = FILLED;
    else if (ce) out[i] = EMPTY;
    else return null;
  }
  return out;
}
