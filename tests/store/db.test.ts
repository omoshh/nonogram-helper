import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  PuzzleRecord, listPuzzles, getPuzzle, putPuzzle, deletePuzzle,
  journalNames, exportAll, importAll,
} from '../../src/store/db';

function rec(id: string, over: Partial<PuzzleRecord> = {}): PuzzleRecord {
  return {
    id, width: 2, height: 2, rows: [[1], [2]], cols: [[1], [2]], givens: [0],
    answerDigits: [], reference: [1, 0, 1, 1], status: 'unique',
    createdAt: '2026-01-01T00:00:00.000Z', ...over,
  };
}

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

describe('store', () => {
  it('round-trips and lists newest first', async () => {
    await putPuzzle(rec('a', { createdAt: '2026-01-01T00:00:00.000Z' }));
    await putPuzzle(rec('b', { createdAt: '2026-03-01T00:00:00.000Z' }));
    await putPuzzle(rec('c', { createdAt: '2026-02-01T00:00:00.000Z' }));
    expect(await getPuzzle('a')).toEqual(rec('a'));
    expect(await getPuzzle('zzz')).toBeUndefined();
    expect((await listPuzzles()).map((p) => p.id)).toEqual(['b', 'c', 'a']);
    await deletePuzzle('b');
    expect((await listPuzzles()).map((p) => p.id)).toEqual(['c', 'a']);
  });

  it('journalNames: distinct, sorted, ignores empty', async () => {
    await putPuzzle(rec('a', { journal: 'Zeta' }));
    await putPuzzle(rec('b', { journal: 'Alpha' }));
    await putPuzzle(rec('c', { journal: 'Zeta' }));
    await putPuzzle(rec('d', { journal: '' }));
    await putPuzzle(rec('e'));
    expect(await journalNames()).toEqual(['Alpha', 'Zeta']);
  });

  it('export then import into an empty DB restores records', async () => {
    const all = [rec('a', { journal: 'J', page: '3', solvedDate: '2026-02-03', thumbnail: 'x', lastMarks: [0, 1, 2, 1] }), rec('b')];
    for (const r of all) await putPuzzle(r);
    const json = await exportAll();
    globalThis.indexedDB = new IDBFactory();
    expect(await importAll(json)).toBe(2);
    expect(await getPuzzle('a')).toEqual(all[0]);
    expect(await getPuzzle('b')).toEqual(all[1]);
  });

  it('import upserts by id', async () => {
    await putPuzzle(rec('a', { journal: 'Old' }));
    const file = JSON.stringify({ app: 'nonogram-helper', version: 1, puzzles: [rec('a', { journal: 'New' })] });
    expect(await importAll(file)).toBe(1);
    expect((await getPuzzle('a'))?.journal).toBe('New');
  });

  const file = (puzzles: unknown[]) => JSON.stringify({ app: 'nonogram-helper', version: 1, puzzles });
  const bad: [string, string, RegExp][] = [
    ['not json', 'not json', /not a valid/],
    ['wrong shape', '{"foo":1}', /not a Nonogram Helper backup/],
    ['wrong version', JSON.stringify({ app: 'nonogram-helper', version: 2, puzzles: [] }), /not a Nonogram Helper backup/],
    ['width string', file([rec('n'), { ...rec('x'), width: 'x' }]), /Puzzle 2 .*\(width\)/],
    ['rows length', file([{ ...rec('x'), rows: [[1]] }]), /Puzzle 1 .*\(rows\)/],
    ['cols length', file([{ ...rec('x'), cols: [[1]] }]), /\(cols\)/],
    ['reference length', file([{ ...rec('x'), reference: [1] }]), /\(reference\)/],
    ['reference value', file([{ ...rec('x'), reference: [1, 0, 1, 3] }]), /\(reference\)/],
    ['given range', file([{ ...rec('x'), givens: [4] }]), /\(givens\)/],
    ['status', file([{ ...rec('x'), status: 'maybe' }]), /\(status\)/],
    ['empty id', file([{ ...rec('x'), id: '' }]), /\(id\)/],
    ['solvedDate', file([{ ...rec('x'), solvedDate: '3 Feb' }]), /\(solvedDate\)/],
    ['lastMarks', file([{ ...rec('x'), lastMarks: [1] }]), /\(lastMarks\)/],
    ['journal type', file([{ ...rec('x'), journal: 5 }]), /\(journal\)/],
  ];
  it.each(bad)('rejects %s and writes nothing', async (_n, json, msg) => {
    await putPuzzle(rec('keep'));
    await expect(importAll(json)).rejects.toThrow(msg);
    expect((await listPuzzles()).map((p) => p.id)).toEqual(['keep']);
  });
});
