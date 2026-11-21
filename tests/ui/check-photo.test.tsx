// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/preact';
import type { TableGeometry } from '../../src/vision/mesh';
import { FILLED, EMPTY, UNKNOWN } from '../../src/core/types';
import { getPuzzle, putPuzzle, type PuzzleRecord } from '../../src/store/db';
import { App } from '../../src/ui/App';

const { detectPhoto, meshFromCornersAsync, rotateSession, closeSession, readMarksAsync } = vi.hoisted(() => ({
  detectPhoto: vi.fn(), meshFromCornersAsync: vi.fn(), rotateSession: vi.fn(), closeSession: vi.fn(), readMarksAsync: vi.fn(),
}));
vi.mock('../../src/worker/visionClient', () => ({ detectPhoto, meshFromCornersAsync, rotateSession, closeSession, readMarksAsync }));
vi.mock('../../src/worker/client', () => ({ solveAsync: vi.fn(), hintAsync: vi.fn() }));

const W = 25, H = 40, ID = 'p25';
function geo(width = W, height = H, depth = 1): TableGeometry {
  const rowClueDepth = depth, colClueDepth = depth, cols = rowClueDepth + width, rows = colClueDepth + height;
  const xs = new Float32Array((cols + 1) * (rows + 1)), ys = new Float32Array(xs.length);
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) { xs[r * (cols + 1) + c] = 100 + c * 10; ys[r * (cols + 1) + c] = 100 + r * 10; }
  return { rotation: 0, width, height, colClueDepth, rowClueDepth, cols, rows, xs, ys, confidence: 0.9 };
}
const session = { id: 7, width: 1000, height: 800, preview: { width: 500, height: 400 } };
const record = (): PuzzleRecord => ({
  id: ID, width: W, height: H, rows: Array.from({ length: H }, () => [1, 1, 1]), cols: Array.from({ length: W }, () => [2]),
  givens: [3], answerDigits: [], reference: Array(W * H).fill(0), status: 'unique',
  createdAt: '2026-11-01T10:00:00.000Z', journal: 'J', page: '1', lastMarks: Array(W * H).fill(EMPTY),
});
const read = (unsure: number[], retake = false) => {
  const cells = new Uint8Array(W * H); cells[1] = FILLED; cells[3] = FILLED;
  readMarksAsync.mockResolvedValue({ cells, unsure, retake, views: unsure.map(() => new Blob(['x'])), ms: 9 });
};

beforeEach(async () => {
  vi.clearAllMocks();
  detectPhoto.mockResolvedValue({ session, result: { ok: true, geometry: geo(), ms: 5 }, ms: 5 });
  meshFromCornersAsync.mockImplementation(async () => geo());
  read([5, 100, 900]);
  URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn();
  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} })) as never;
  Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 400, right: 500, bottom: 400, x: 0, y: 0, toJSON() {} });
  globalThis.indexedDB = new IDBFactory();
  await putPuzzle(record());
});
afterEach(async () => { cleanup(); await new Promise((r) => setTimeout(r, 20)); });

const btn = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
async function toGridCheck() {
  location.hash = `#/p/${ID}/check`;
  const view = render(<App />);
  await screen.findByRole('button', { name: 'Check' });
  const input = view.container.querySelector('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.jpg')], configurable: true });
  fireEvent.change(input);
  await waitFor(() => expect(btn('Use this grid').disabled).toBe(false));
  return view;
}
async function toReview() {
  const view = await toGridCheck();
  fireEvent.click(btn('Use this grid'));
  await screen.findByRole('heading', { name: /to check$/ });
  return view;
}
const filled = (c: Element) => c.querySelectorAll('.grid-cell.filled').length;
const cellEl = (c: Element, i: number) => c.querySelector(`[data-cell="${i}"]`) as HTMLElement;

test('review shows the read marks, Check waits for every unsure cell, then saves and shows the result without a reveal', async () => {
  const { container } = await toReview();
  screen.getByRole('heading', { name: '3 cells to check' });
  expect(filled(container)).toBe(2); // read marks (1 and the given 3), not the old all-dot marks
  expect(container.querySelectorAll('.grid-cell.empty')).toHaveLength(0);
  expect(btn('Check').disabled).toBe(true);
  fireEvent.click(btn('Next')); screen.getByText('2/3');
  expect(btn('Check').disabled).toBe(true);
  fireEvent.click(btn('Next')); screen.getByText('3/3');
  expect(btn('Check').disabled).toBe(false);
  fireEvent.click(btn('Check'));
  await screen.findByRole('button', { name: 'Mistakes' });
  expect(screen.queryByText(/mistake\b/)).toBeNull();
  const saved = (await getPuzzle(ID))!.lastMarks!;
  expect(saved[1]).toBe(FILLED); expect(saved[0]).toBe(UNKNOWN);
});

test('Filled on the current unsure cell changes that cell and is saved', async () => {
  const { container } = await toReview();
  fireEvent.click(btn('Filled'));
  expect(cellEl(container, 5).className).toContain('filled');
  fireEvent.click(btn('Next')); fireEvent.click(btn('Next'));
  fireEvent.click(btn('Check'));
  await screen.findByRole('button', { name: 'Mistakes' });
  expect((await getPuzzle(ID))!.lastMarks![5]).toBe(FILLED);
});

test('a tap just before Check still counts', async () => {
  const { container } = await toReview();
  fireEvent.click(btn('Next')); fireEvent.click(btn('Next'));
  fireEvent.click(cellEl(container, 200), { detail: 1 }); // deferred 250 ms by the grid
  fireEvent.click(btn('Check'));
  await screen.findByRole('button', { name: 'Mistakes' });
  expect((await getPuzzle(ID))!.lastMarks![200]).toBe(FILLED);
});

test('the review opens fitted with the rings in view; a step zooms to that cell', async () => {
  const spy = vi.fn();
  Element.prototype.scrollIntoView = spy;
  const { container } = await toReview();
  const px = () => parseFloat((container.querySelector('.grid') as HTMLElement).style.getPropertyValue('--cell'));
  expect(px() * W).toBeLessThanOrEqual(window.innerWidth);
  expect(btn('Zoom').getAttribute('aria-pressed')).toBe('false');
  expect(spy).not.toHaveBeenCalled();
  expect(cellEl(container, 5).className).toContain('ring');
  fireEvent.click(btn('Next'));
  expect(px()).toBeGreaterThanOrEqual(28);
  expect(spy.mock.contexts.at(-1)).toBe(cellEl(container, 100));
  expect(container.querySelector('.grid-scroll')!.contains(btn('Zoom'))).toBe(false);
});

test('no unsure cells: no stepper, Check enabled at once', async () => {
  read([]);
  await toReview();
  screen.getByRole('heading', { name: '0 cells to check' });
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  expect(btn('Check').disabled).toBe(false);
});

const RETAKE = /The marks cannot be read safely from this photo/;
const TIP = /Avoid the flashlight/;

test('a retake read opens no review: it asks for a new photo and keeps the saved marks', async () => {
  read([5, 100, 900], true);
  const { container } = await toGridCheck();
  fireEvent.click(btn('Use this grid'));
  await screen.findByText(RETAKE);
  expect(screen.queryByRole('heading', { name: /to check$/ })).toBeNull();
  expect(filled(container)).toBe(1); // only the given: the saved all-dot marks stay
  expect(closeSession).toHaveBeenCalled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect((await getPuzzle(ID))!.lastMarks).toEqual(record().lastMarks);
});

test('a normal read shows no retake message', async () => {
  await toReview();
  expect(screen.queryByText(RETAKE)).toBeNull();
});

test('the check page gives a light tip next to the Photo button', async () => {
  location.hash = `#/p/${ID}/check`;
  render(<App />);
  await screen.findByText(TIP);
});

test('one unsure cell reads "1 cell to check"', async () => {
  read([5]);
  await toReview();
  screen.getByRole('heading', { name: '1 cell to check' });
  expect(btn('Check').disabled).toBe(false);
});

test('Cancel in the review keeps the old saved marks', async () => {
  const { container } = await toReview();
  fireEvent.click(btn('Cancel'));
  await screen.findByRole('heading', { name: 'Check my grid' });
  expect(container.querySelectorAll('.grid-cell.empty').length).toBeGreaterThan(900);
  expect((await getPuzzle(ID))!.lastMarks!.every((v) => v === EMPTY)).toBe(true);
});

test('a photo of another size gives the size error and no review', async () => {
  await toGridCheck();
  meshFromCornersAsync.mockImplementation(async () => geo(25, 35));
  fireEvent.click(btn('Use this grid'));
  await screen.findByText('This photo shows a 25×35 grid; this puzzle is 25×40.');
  expect(readMarksAsync).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: /to check$/ })).toBeNull();
  expect((await getPuzzle(ID))!.lastMarks!.every((v) => v === EMPTY)).toBe(true);
  expect(closeSession).toHaveBeenCalledWith(7);
});

test('a failed read shows its cause', async () => {
  readMarksAsync.mockRejectedValue(new Error('boom'));
  await toGridCheck();
  fireEvent.click(btn('Use this grid'));
  await screen.findByText('Could not read the marks. (boom)');
  expect((await getPuzzle(ID))!.lastMarks!.every((v) => v === EMPTY)).toBe(true);
});

test('recognition gets only the session, the geometry and the givens, never the solution', async () => {
  await toReview();
  expect(readMarksAsync).toHaveBeenCalledTimes(1);
  const [sid, g, givens] = readMarksAsync.mock.calls[0];
  expect(sid).toBe(7); expect(g.width).toBe(W); expect(givens).toEqual([3]);
  expect(readMarksAsync.mock.calls[0]).toHaveLength(3);
  expect(JSON.stringify([sid, givens])).not.toContain('reference');
  expect(closeSession).toHaveBeenCalledWith(7);
});

test('an old record with failed detection meshes with the longest clue lists', async () => {
  detectPhoto.mockResolvedValue({ session, result: { ok: false, reason: 'x' }, ms: 5 });
  location.hash = `#/p/${ID}/check`;
  const view = render(<App />);
  await screen.findByRole('button', { name: 'Check' });
  const input = view.container.querySelector('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.jpg')], configurable: true });
  fireEvent.change(input);
  await screen.findByText(/Could not find the puzzle/);
  expect((screen.getByLabelText('Size') as HTMLSelectElement).value).toBe(`${W}x${H}`);
  expect((screen.getByLabelText('Row clue depth') as HTMLInputElement).value).toBe('3');
  expect((screen.getByLabelText('Column clue depth') as HTMLInputElement).value).toBe('1');
  fireEvent.click(btn('Use this grid'));
  await waitFor(() => expect(meshFromCornersAsync.mock.lastCall?.[2]).toMatchObject({ width: W, height: H, rowClueDepth: 3, colClueDepth: 1 }));
});

it('reminds to enter the printed cells before a photo when no givens are saved', async () => {
  await putPuzzle({ ...record(), givens: [] });
  location.hash = `#/p/${ID}/check`;
  render(<App />);
  await screen.findByText(/Enter the printed cells first/);
});

it('shows no givens reminder when givens are saved', async () => {
  location.hash = `#/p/${ID}/check`;
  render(<App />);
  await screen.findByRole('button', { name: 'Check' });
  expect(screen.queryByText(/Enter the printed cells first/)).toBeNull();
});
