// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/preact';
import { exportAll, listPuzzles, putPuzzle } from '../../src/store/db';
import { PuzzleList } from '../../src/ui/PuzzleList';

const rec = (id: string) => ({
  id, width: 1, height: 1, rows: [[1]], cols: [[1]], givens: [], answerDigits: [], reference: [1],
  status: 'unique' as const, createdAt: '2026-11-01T10:00:00.000Z',
});

const stubConfirm = (answer: boolean) => { const fn = vi.fn(() => answer); vi.stubGlobal('confirm', fn); return fn; };

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function pick(json: string) {
  const { container } = render(<PuzzleList />);
  const input = container.querySelector('input[type=file]') as HTMLInputElement;
  const file = new File([json], 'b.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

test('declining the replace confirm imports nothing', async () => {
  await putPuzzle({ ...rec('a'), journal: 'old' });
  const file = JSON.stringify({ app: 'nonogram-helper', version: 1, puzzles: [{ ...rec('a'), journal: 'new' }, { ...rec('b'), reference: [1] }] });
  const confirm = stubConfirm(false);
  await pick(file);
  await waitFor(() => expect(confirm).toHaveBeenCalledWith('1 puzzle in the file already exists on this phone and will be replaced. Continue?'));
  await new Promise((r) => setTimeout(r, 50));
  const all = await listPuzzles();
  expect(all).toHaveLength(1);
  expect(all[0].journal).toBe('old');
});

test('accepting the confirm imports', async () => {
  await putPuzzle(rec('a'));
  const file = await exportAll();
  stubConfirm(true);
  await pick(file);
  await screen.findByText('1 puzzle imported');
});
