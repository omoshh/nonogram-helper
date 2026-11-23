import type { LineRef } from '../core/types';
import type { Point } from '../vision/types';
import type { TableGeometry, TableSize } from '../vision/mesh';
import type { PhotoSession, DetectResult, Label, VisionRequest, VisionResponse } from './vision.worker';

export type { PhotoSession };

interface Pending {
  resolve: (r: VisionResponse & { ok: true }) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function rejectAll(message: string): void {
  worker?.terminate();
  worker = null;
  const err = new Error(message);
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<VisionResponse>) => {
    const msg = e.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg);
    else p.reject(new Error(msg.error));
  };
  // A failed load is almost always a stale tab after a deploy (old chunk gone).
  w.onerror = () => rejectAll('The app was updated. Reload the page.');
  w.onmessageerror = () => rejectAll('worker message error');
  worker = w;
  return w;
}

function request<K extends Exclude<VisionResponse, { ok: false }>['kind']>(
  req: DistributiveOmit<VisionRequest, 'id'>,
): Promise<Extract<VisionResponse, { ok: true; kind: K }>> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve: resolve as Pending['resolve'], reject });
    try {
      getWorker().postMessage({ ...req, id });
    } catch (err) {
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

/** ms is the detect() time, not decode. */
export async function detectPhoto(file: Blob): Promise<{ session: PhotoSession; result: DetectResult; label: Label; ms: number }> {
  const { session, result, label, ms } = await request<'detect'>({ kind: 'detect', file });
  return { session, result, label, ms };
}

export async function meshFromCornersAsync(sessionId: number, gridCorners: Point[], size: TableSize): Promise<TableGeometry> {
  return (await request<'mesh'>({ kind: 'mesh', sessionId, corners: gridCorners, size })).geometry;
}

export async function rotateSession(sessionId: number, _quarterTurnsCW: 1): Promise<{ session: PhotoSession; result: DetectResult; label: Label }> {
  const { session, result, label } = await request<'rotate'>({ kind: 'rotate', sessionId });
  return { session, result, label };
}

export async function stripsAsync(
  sessionId: number,
  g: TableGeometry,
  px: number,
): Promise<{ rows: Blob[]; cols: Blob[] }> {
  const { rows, cols } = await request<'strips'>({ kind: 'strips', sessionId, g, px });
  return { rows, cols };
}

export async function readMarksAsync(
  sessionId: number,
  g: TableGeometry,
  givens: number[],
): Promise<{ cells: Uint8Array; unsure: number[]; retake: boolean; views: Blob[]; ms: number }> {
  const { cells, unsure, retake, views, ms } = await request<'marks'>({ kind: 'marks', sessionId, g, givens });
  return { cells, unsure, retake, views, ms };
}

export async function readCluesAsync(
  sessionId: number,
  g: TableGeometry,
): Promise<{ rows: number[][]; cols: number[][]; unsure: LineRef[]; ms: number }> {
  const { rows, cols, unsure, ms } = await request<'clues'>({ kind: 'clues', sessionId, g });
  return { rows, cols, unsure, ms };
}

export function closeSession(sessionId: number): void {
  request<'close'>({ kind: 'close', sessionId }).catch(() => {});
}
