// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/preact';
import { solve } from '../../src/core/solver';
import { nextHint } from '../../src/core/hint';
import { hintText } from '../../src/core/text';
import { FILLED, EMPTY, UNKNOWN, type Puzzle } from '../../src/core/types';
import { getPuzzle, putPuzzle, type PuzzleRecord } from '../../src/store/db';
import { App } from '../../src/ui/App';

const { solveAsync, hintAsync } = vi.hoisted(() => ({ solveAsync: vi.fn(), hintAsync: vi.fn() }));
vi.mock('../../src/worker/client', () => ({ solveAsync, hintAsync }));

// solution ####x/#xx#x/####x/#xxxx/#xxxx
const P5: Puzzle = { width: 5, height: 5,
  rows: [[4], [1, 1], [4], [1], [1]], cols: [[5], [1, 1], [1, 1], [3], []], givens: [] };
const ID = 'p5';
const record = (): PuzzleRecord => ({
  id: ID, ...P5, answerDigits: [], reference: Array.from(solve(P5).reference!), status: 'unique',
  createdAt: '2026-11-01T10:00:00.000Z', journal: 'Japan', page: '12', lastMarks: Array(25).fill(EMPTY),
});

beforeEach(async () => {
  hintAsync.mockReset();
  solveAsync.mockImplementation(async (p: Puzzle) => solve(p));
  hintAsync.mockImplementation(async (p: Puzzle, m: Uint8Array, r: Uint8Array) => ({ hint: nextHint(p, m, r), ms: 1 }));
  globalThis.indexedDB = new IDBFactory();
  await putPuzzle({ ...record(), lastMarks: undefined });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openCheck() {
  location.hash = `#/p/${ID}/check`;
  const view = render(<App />);
  await screen.findByRole('button', { name: 'Check' });
  return view;
}
const cell = (c: Element, i: number) => c.querySelector(`[data-cell="${i}"]`) as HTMLElement;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

test('one wrong cell: mistakes one level per tap, hint refused only when tapped', async () => {
  const { container } = await openCheck();
  fireEvent.click(cell(container, 0)); // filled, right
  fireEvent.click(cell(container, 4)); // filled, wrong (column 5 is empty)
  fireEvent.click(button('Check'));
  const mistakes = await screen.findByRole('button', { name: 'Mistakes' });
  expect(screen.queryByText('1 mistake.')).toBeNull();
  // Nothing tells whether mistakes exist before a tap.
  expect(button('Hint').disabled).toBe(false);
  expect(screen.queryByText('Fix the mistakes first.')).toBeNull();
  fireEvent.click(button('Hint'));
  await screen.findByText('Fix the mistakes first.');
  expect(hintAsync).not.toHaveBeenCalled();
  expect(screen.queryByText('1 mistake.')).toBeNull();
  expect(container.querySelectorAll('.marked')).toHaveLength(0);

  fireEvent.click(mistakes);
  screen.getByText('1 mistake.');
  expect(screen.queryByText(/Rows:/)).toBeNull();
  fireEvent.click(button('Which rows and columns?'));
  screen.getByText('Rows: 1 (1). Columns: 5 (1).');
  expect(cell(container, 4).classList.contains('marked')).toBe(false);
  fireEvent.click(button('Show them on the grid'));
  expect(cell(container, 4).classList.contains('marked')).toBe(true);
  expect(container.querySelectorAll('.marked')).toHaveLength(1);
});

test('correct marks: hint levels appear one tap at a time', async () => {
  const { container } = await openCheck();
  fireEvent.click(cell(container, 0));
  fireEvent.click(button('Check'));
  const marks = new Uint8Array(25); marks[0] = FILLED;
  const hint = nextHint(P5, marks, solve(P5).reference!);
  expect(hint.kind).toBe('line');
  const texts = ([1, 2, 3] as const).map((l) => hintText(P5, hint, l));

  fireEvent.click(await screen.findByRole('button', { name: 'Hint' }));
  await screen.findByText(texts[0]);
  expect(screen.queryByText(texts[1])).toBeNull();
  expect(container.querySelectorAll('.marked')).toHaveLength(0);
  fireEvent.click(button('Which cells?'));
  screen.getByText(texts[1]);
  expect(screen.queryByText(texts[2])).toBeNull();
  expect(container.querySelectorAll('.marked').length).toBe((hint as { cells: number[] }).cells.length);
  fireEvent.click(button('Why?'));
  screen.getByText(texts[2]);
  expect(screen.queryByRole('button', { name: 'Why?' })).toBeNull();
});

test('changing a mark after Check hides the results', async () => {
  const { container } = await openCheck();
  fireEvent.click(button('Check'));
  fireEvent.click(await screen.findByRole('button', { name: 'Mistakes' }));
  screen.getByText('No mistakes.');
  fireEvent.click(cell(container, 0));
  expect(screen.queryByText('No mistakes.')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Mistakes' })).toBeNull();
});

test('Check saves the marks; the dot mode sets dots', async () => {
  const { container } = await openCheck();
  fireEvent.click(cell(container, 0));
  fireEvent.click(button('Dot'));
  fireEvent.click(cell(container, 4));
  fireEvent.click(cell(container, 4));
  fireEvent.click(button('Check'));
  await screen.findByRole('button', { name: 'Mistakes' });
  const saved = await getPuzzle(ID);
  const expected = Array(25).fill(UNKNOWN); expected[0] = FILLED; expected[4] = EMPTY;
  expect(saved!.lastMarks).toEqual(expected);
});

test('Show solution only after the confirm', async () => {
  location.hash = `#/p/${ID}`;
  const { container } = render(<App />);
  await screen.findByText('Puzzle 5 × 5');
  const confirm = vi.fn(() => false);
  vi.stubGlobal('confirm', confirm);
  fireEvent.click(button('Show solution'));
  expect(confirm).toHaveBeenCalledWith('Show the full solution?');
  expect(container.querySelector('.grid')).toBeNull();
  confirm.mockReturnValue(true);
  fireEvent.click(button('Show solution'));
  expect(container.querySelectorAll('.grid-cell.filled')).toHaveLength(12);
});

test('Edit clues: a failed solve keeps the record, a good one replaces it', async () => {
  await putPuzzle(record());
  location.hash = `#/p/${ID}/clues`;
  render(<App />);
  const col = async (i: number, v: string) =>
    fireEvent.input(await screen.findByLabelText(`Column ${i}`), { target: { value: v } });
  await col(4, '2');
  await col(5, '1');
  fireEvent.click(button('Solve'));
  await screen.findByText('No solution. Some clues are probably wrong.');
  const before = await getPuzzle(ID);
  expect(before).toEqual(record());

  // mirror image: still unique, different solution
  for (const [i, v] of [[1, ''], [2, '3'], [3, '1 1'], [4, '1 1'], [5, '5']] as const) await col(i, v);
  fireEvent.click(button('Solve'));
  await waitFor(() => expect(location.hash).toBe(`#/p/${ID}`));
  const after = (await getPuzzle(ID))!;
  expect(after).toMatchObject({ id: ID, createdAt: record().createdAt, journal: 'Japan', page: '12',
    status: 'unique', cols: [[], [3], [1, 1], [1, 1], [5]] });
  expect(after.lastMarks).toBeUndefined();
  expect(after.reference.slice(0, 5)).toEqual([EMPTY, FILLED, FILLED, FILLED, FILLED]);
});

test('puzzle page saves journal and solved date', async () => {
  location.hash = `#/p/${ID}`;
  render(<App />);
  fireEvent.input(await screen.findByLabelText('Journal'), { target: { value: 'Hobby' } });
  fireEvent.click(button('Mark as solved'));
  await waitFor(async () => expect((await getPuzzle(ID))!.journal).toBe('Hobby'));
  await waitFor(async () => expect((await getPuzzle(ID))!.solvedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/));
});

test('a puzzle saved with more than one solution shows the note', async () => {
  await putPuzzle({ ...record(), status: 'multiple' });
  location.hash = `#/p/${ID}`;
  render(<App />);
  await screen.findByText('This puzzle has more than one solution. Only cells that are the same in all solutions are checked.');
});
