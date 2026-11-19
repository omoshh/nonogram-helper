import type { Puzzle } from '../core/types';
import type { SolveResult } from '../core/solver';
import type { Hint } from '../core/hint';
import type { WorkerRequest, WorkerResponse } from './solver.worker';

interface Pending {
  resolve: (r: WorkerResponse & { ok: true }) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function rejectAll(message: string): void {
  const err = new Error(message);
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg);
    else p.reject(new Error(msg.error));
  };
  w.onerror = (e) => rejectAll(e.message || 'worker error');
  w.onmessageerror = () => rejectAll('worker message error');
  worker = w;
  return w;
}

function request(req: DistributiveOmit<WorkerRequest, 'id'>): Promise<WorkerResponse & { ok: true }> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...req, id });
  });
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

export async function solveAsync(p: Puzzle): Promise<SolveResult> {
  const r = await request({ kind: 'solve', puzzle: p });
  return (r as Extract<WorkerResponse, { kind: 'solve' }>).result;
}

export async function hintAsync(
  p: Puzzle,
  marks: Uint8Array,
  reference: Uint8Array,
): Promise<{ hint: Hint; ms: number }> {
  const r = (await request({ kind: 'hint', puzzle: p, marks, reference })) as Extract<WorkerResponse, { kind: 'hint' }>;
  return { hint: r.hint, ms: r.ms };
}
