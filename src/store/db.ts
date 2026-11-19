import { openDB } from 'idb';

export interface PuzzleRecord {
  id: string; // crypto.randomUUID()
  journal?: string;
  page?: string;
  solvedDate?: string; // 'YYYY-MM-DD'
  width: number;
  height: number;
  rows: number[][];
  cols: number[][];
  givens: number[];
  answerDigits: { cell: number; digit: number }[];
  reference: number[];
  status: 'unique' | 'multiple';
  createdAt: string; // ISO
  thumbnail?: string;
  lastMarks?: number[]; // last confirmed marks, to start the next check from
}

// Opened per call so a swapped IndexedDB factory (tests) never meets a stale connection.
async function withStore<T>(mode: IDBTransactionMode, fn: (s: any, tx: any) => Promise<T>): Promise<T> {
  const db = await openDB('nonogram-helper', 1, {
    upgrade(d) { d.createObjectStore('puzzles', { keyPath: 'id' }); },
  });
  try {
    const tx = db.transaction('puzzles', mode);
    const result = await fn(tx.store, tx);
    await tx.done;
    return result;
  } finally {
    db.close();
  }
}

export async function listPuzzles(): Promise<PuzzleRecord[]> {
  const all = await withStore('readonly', (s) => s.getAll() as Promise<PuzzleRecord[]>);
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export const getPuzzle = (id: string): Promise<PuzzleRecord | undefined> =>
  withStore('readonly', (s) => s.get(id));

export const putPuzzle = (r: PuzzleRecord): Promise<void> =>
  withStore('readwrite', async (s) => { await s.put(r); });

export const deletePuzzle = (id: string): Promise<void> =>
  withStore('readwrite', async (s) => { await s.delete(id); });

export async function journalNames(): Promise<string[]> {
  const names = (await listPuzzles()).map((p) => p.journal).filter((j): j is string => !!j);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

export async function exportAll(): Promise<string> {
  return JSON.stringify({ app: 'nonogram-helper', version: 1, puzzles: await listPuzzles() });
}

const isInt = (v: unknown): v is number => Number.isInteger(v);
const isPosInt = (v: unknown): v is number => isInt(v) && (v as number) > 0;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isArr = (v: unknown): v is unknown[] => Array.isArray(v);
const marks = (v: unknown, n: number) =>
  isArr(v) && v.length === n && v.every((x) => x === 0 || x === 1 || x === 2);

/** Name of the first damaged field, or null when the record is fine. */
function badField(r: any): string | null {
  if (!r || typeof r !== 'object') return 'record';
  if (!isStr(r.id) || r.id === '') return 'id';
  if (!isPosInt(r.width)) return 'width';
  if (!isPosInt(r.height)) return 'height';
  const { width: w, height: h } = r;
  const clues = (v: unknown, n: number) =>
    isArr(v) && v.length === n && v.every((l) => isArr(l) && l.every(isPosInt));
  if (!clues(r.rows, h)) return 'rows';
  if (!clues(r.cols, w)) return 'cols';
  if (!isArr(r.givens) || !r.givens.every((g: unknown) => isInt(g) && g >= 0 && g < w * h)) return 'givens';
  if (!isArr(r.answerDigits) || !r.answerDigits.every((a: any) => a && isInt(a.cell) && isInt(a.digit))) return 'answerDigits';
  if (!marks(r.reference, w * h)) return 'reference';
  if (r.status !== 'unique' && r.status !== 'multiple') return 'status';
  if (!isStr(r.createdAt)) return 'createdAt';
  for (const k of ['journal', 'page', 'thumbnail']) {
    if (r[k] !== undefined && !isStr(r[k])) return k;
  }
  if (r.solvedDate !== undefined && !(isStr(r.solvedDate) && /^\d{4}-\d{2}-\d{2}$/.test(r.solvedDate))) return 'solvedDate';
  if (r.lastMarks !== undefined && !marks(r.lastMarks, w * h)) return 'lastMarks';
  return null;
}

export async function importAll(json: string): Promise<number> {
  let data: any;
  try { data = JSON.parse(json); } catch { throw new Error('This file is not a valid backup (it could not be read).'); }
  if (!data || data.app !== 'nonogram-helper' || data.version !== 1 || !isArr(data.puzzles)) {
    throw new Error('This file is not a Nonogram Helper backup.');
  }
  const puzzles = data.puzzles as PuzzleRecord[];
  puzzles.forEach((p, i) => {
    const bad = badField(p);
    if (bad) throw new Error(`Puzzle ${i + 1} in the file is damaged (${bad}).`);
  });
  // One transaction: all records are written or none.
  await withStore('readwrite', async (s) => { await Promise.all(puzzles.map((p) => s.put(p))); });
  return puzzles.length;
}
