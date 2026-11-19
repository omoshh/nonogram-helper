// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/preact';
import { solve } from '../../src/core/solver';
import type { Puzzle } from '../../src/core/types';
import type { SolveResult } from '../../src/core/solver';
import { listPuzzles } from '../../src/store/db';
import { App } from '../../src/ui/App';

const { solveAsync } = vi.hoisted(() => ({ solveAsync: vi.fn() }));
vi.mock('../../src/worker/client', () => ({ solveAsync }));

beforeEach(() => {
  solveAsync.mockImplementation(async (p: Puzzle) => solve(p));
  globalThis.indexedDB = new IDBFactory();
  location.hash = '#/new';
});
afterEach(cleanup);

function enter(width: number, height: number, rows: string[], cols: string[]) {
  render(<App />);
  fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'custom' } });
  fireEvent.input(screen.getByLabelText('Width'), { target: { value: String(width) } });
  fireEvent.input(screen.getByLabelText('Height'), { target: { value: String(height) } });
  fireEvent.click(screen.getByRole('button', { name: 'Enter clues' }));
  rows.forEach((t, i) => fireEvent.input(screen.getByLabelText(`Row ${i + 1}`), { target: { value: t } }));
  cols.forEach((t, i) => fireEvent.input(screen.getByLabelText(`Column ${i + 1}`), { target: { value: t } }));
}

const solveButton = () => screen.getByRole('button', { name: 'Solve' }) as HTMLButtonElement;

test('a unique puzzle is saved and its page opens', async () => {
  enter(5, 5, ['4', '1 1', '4', '1', '1'], ['5', '1.1', '1,1', '3', '']);
  fireEvent.click(solveButton());
  await waitFor(() => expect(location.hash).toMatch(/^#\/p\/[\w-]+$/));
  const saved = await listPuzzles();
  expect(saved).toHaveLength(1);
  expect(location.hash).toBe(`#/p/${saved[0].id}`);
  expect(saved[0]).toMatchObject({
    width: 5, height: 5, status: 'unique', answerDigits: [],
    rows: [[4], [1, 1], [4], [1], [1]], cols: [[5], [1, 1], [1, 1], [3], []],
  });
  expect(saved[0].reference).toHaveLength(25);
});

test('two solutions: warning and Save anyway', async () => {
  enter(2, 2, ['1', '1'], ['1', '1']);
  fireEvent.click(solveButton());
  await screen.findByText(/More than one solution/);
  fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
  await waitFor(() => expect(location.hash).toMatch(/^#\/p\//));
  expect((await listPuzzles())[0].status).toBe('multiple');
});

test('an invalid clue field blocks Solve', () => {
  enter(2, 2, ['1', '3a'], ['1', '1']);
  expect(screen.getByLabelText('Row 2').getAttribute('aria-invalid')).toBe('true');
  expect(solveButton().disabled).toBe(true);
});

test('a sum mismatch is explained and the long line flagged', async () => {
  enter(2, 2, ['1', '3'], ['1', '1']);
  fireEvent.click(solveButton());
  await screen.findByText('Row sums 4, column sums 2.');
  screen.getByText('Row 2 needs 3 cells but has 2.');
  expect(screen.getByLabelText('Row 2').closest('.clue-line')!.classList.contains('flagged')).toBe(true);
  screen.getByRole('button', { name: 'Row 2' }); // in "Check these lines"
});

test('a result that arrives after an edit is dropped', async () => {
  let finish!: (r: SolveResult) => void;
  solveAsync.mockImplementation((p: Puzzle) => new Promise((res) => { finish = () => res(solve(p)); }));
  enter(5, 5, ['4', '1 1', '4', '1', '1'], ['5', '1.1', '1,1', '3', '']);
  fireEvent.click(solveButton());
  fireEvent.input(screen.getByLabelText('Row 5'), { target: { value: '2' } });
  finish(undefined as never);
  await new Promise((r) => setTimeout(r, 50));
  expect(location.hash).toBe('#/new');
  expect(await listPuzzles()).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'Save anyway' })).toBeNull();
});

test('Save anyway tapped twice saves one record', async () => {
  enter(2, 2, ['1', '1'], ['1', '1']);
  fireEvent.click(solveButton());
  const button = await screen.findByRole('button', { name: 'Save anyway' });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(location.hash).toMatch(/^#\/p\//));
  expect(await listPuzzles()).toHaveLength(1);
});

test('a timed-out solve does not blame the clues', async () => {
  solveAsync.mockResolvedValue({
    status: 'multiple', reference: new Uint8Array(4), suspect: [{ axis: 'row', index: 0 }], ms: 5000, timedOut: true,
  } satisfies SolveResult);
  enter(2, 2, ['1', '1'], ['1', '1']);
  fireEvent.click(solveButton());
  await screen.findByText('The solver ran out of time. The puzzle may still be correct.');
  screen.getByRole('button', { name: 'Save anyway' });
  expect(screen.queryByText(/probably wrong/)).toBeNull();
});
