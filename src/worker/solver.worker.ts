import type { Puzzle } from '../core/types';
import { solve, type SolveResult } from '../core/solver';
import { nextHint, type Hint } from '../core/hint';

export type WorkerRequest =
  | { id: number; kind: 'solve'; puzzle: Puzzle }
  | { id: number; kind: 'hint'; puzzle: Puzzle; marks: Uint8Array; reference: Uint8Array };

export type WorkerResponse =
  | { id: number; ok: true; kind: 'solve'; result: SolveResult }
  | { id: number; ok: true; kind: 'hint'; hint: Hint; ms: number }
  | { id: number; ok: false; error: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.kind === 'solve') {
      const result = solve(req.puzzle);
      post({ id: req.id, ok: true, kind: 'solve', result });
    } else {
      const t0 = performance.now();
      const hint = nextHint(req.puzzle, req.marks, req.reference);
      post({ id: req.id, ok: true, kind: 'hint', hint, ms: performance.now() - t0 });
    }
  } catch (err) {
    post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};

function post(msg: WorkerResponse): void {
  (self as unknown as Worker).postMessage(msg);
}
