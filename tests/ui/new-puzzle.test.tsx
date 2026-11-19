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
const visionMocks = vi.hoisted(() => ({ detectPhoto: vi.fn(), meshFromCornersAsync: vi.fn(), rotateSession: vi.fn(), stripsAsync: vi.fn(), closeSession: vi.fn() }));
vi.mock('../../src/worker/visionClient', () => visionMocks);

const stubConfirm = (answer: boolean) => { const fn = vi.fn(() => answer); vi.stubGlobal('confirm', fn); return fn; };

beforeEach(() => {
  solveAsync.mockImplementation(async (p: Puzzle) => solve(p));
  globalThis.indexedDB = new IDBFactory();
  location.hash = '#/new';
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());
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

const changeSize = () => screen.getByRole('button', { name: /Change size/ });

test('Change size keeps the clues when the confirm is declined', () => {
  const confirm = stubConfirm(false);
  enter(2, 2, ['1', ''], ['', '']);
  fireEvent.click(changeSize());
  expect(confirm).toHaveBeenCalledWith('Discard the clues you typed?');
  expect((screen.getByLabelText('Row 1') as HTMLInputElement).value).toBe('1');
});

test('Change size clears the clues when confirmed, and asks nothing when empty', () => {
  const confirm = stubConfirm(true);
  enter(2, 2, ['1', ''], ['', '']);
  fireEvent.click(changeSize());
  screen.getByRole('button', { name: 'Enter clues' });
  expect(sessionStorage.getItem('nonogram-new-draft')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Enter clues' }));
  fireEvent.click(changeSize());
  expect(confirm).toHaveBeenCalledTimes(1);
});

test('typed clues survive leaving and reopening the screen, and a save clears the draft', async () => {
  enter(2, 2, ['1', '1'], ['1', '']);
  cleanup();
  render(<App />);
  expect((screen.getByLabelText('Row 2') as HTMLInputElement).value).toBe('1');
  expect((screen.getByLabelText('Column 1') as HTMLInputElement).value).toBe('1');
  fireEvent.input(screen.getByLabelText('Column 2'), { target: { value: '1' } });
  fireEvent.click(solveButton());
  await screen.findByRole('button', { name: 'Save anyway' });
  fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
  await waitFor(() => expect(location.hash).toMatch(/^#\/p\//));
  expect(sessionStorage.getItem('nonogram-new-draft')).toBeNull();
});

test('a timed-out Save anyway shows the timeout note on the puzzle page', async () => {
  solveAsync.mockResolvedValue({
    status: 'multiple', reference: new Uint8Array(4), suspect: [], ms: 5000, timedOut: true,
  } satisfies SolveResult);
  enter(2, 2, ['1', '1'], ['1', '1']);
  fireEvent.click(solveButton());
  fireEvent.click(await screen.findByRole('button', { name: 'Save anyway' }));
  await waitFor(() => expect(location.hash).toMatch(/^#\/p\//));
  expect((await listPuzzles())[0].timedOut).toBe(true);
  cleanup();
  render(<App />);
  await screen.findByText('The solver ran out of time on this puzzle. Only cells it could prove are checked.');
  expect(screen.queryByText(/more than one solution/)).toBeNull();
});

test('No solution with no suspect line says so', async () => {
  solveAsync.mockResolvedValue({ status: 'none', reference: null, suspect: [], ms: 1, timedOut: false } satisfies SolveResult);
  enter(2, 2, ['1', '1'], ['1', '1']);
  fireEvent.click(solveButton());
  await screen.findByText('No single line stands out; compare every line with the puzzle.');
});

describe('from photo', () => {
  const cols = 4, rows = 3;
  const xs = new Float32Array((cols + 1) * (rows + 1)), ys = new Float32Array(xs.length);
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) { xs[r * (cols + 1) + c] = 100 + c * 30; ys[r * (cols + 1) + c] = 100 + r * 30; }
  const geometry = { rotation: 0 as const, width: 3, height: 2, colClueDepth: 1, rowClueDepth: 1, cols, rows, xs, ys, confidence: 0.9 };
  const blob = (n: string) => new Blob([n], { type: 'image/png' });
  const photoSession = { id: 7, width: 1000, height: 800, preview: { width: 500, height: 400 } };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
    visionMocks.detectPhoto.mockResolvedValue({ session: photoSession, result: { ok: true, geometry, ms: 1 }, ms: 1 });
    visionMocks.meshFromCornersAsync.mockResolvedValue(geometry);
    visionMocks.stripsAsync.mockResolvedValue({ rows: [blob('r1'), blob('r2')], cols: [blob('c1'), blob('c2'), blob('c3')], thumbnail: blob('t') });
    HTMLCanvasElement.prototype.getContext = (() => ({ drawImage() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} })) as never;
    Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 400, right: 500, bottom: 400, x: 0, y: 0, toJSON() {} });
  });

  async function pickAndConfirm() {
    const { container } = render(<App />);
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.jpg')] } });
    const use = await screen.findByRole('button', { name: 'Use this grid' });
    await waitFor(() => expect((use as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(use);
    return container;
  }

  test('detected size, one strip per line, thumbnail saved, session closed', async () => {
    const c = await pickAndConfirm();
    await screen.findByLabelText('Row 2');
    expect(screen.getByRole('heading', { name: /3 × 2/ })).toBeTruthy();
    expect(c.querySelectorAll('.clue-line img')).toHaveLength(5);
    expect(visionMocks.stripsAsync.mock.calls[0][2]).toBe(40);
    ['1', '1'].forEach((t, i) => fireEvent.input(screen.getByLabelText(`Row ${i + 1}`), { target: { value: i ? '1' : '3' } }));
    ['1', '2', '1'].forEach((t, i) => fireEvent.input(screen.getByLabelText(`Column ${i + 1}`), { target: { value: i === 1 ? '2' : '1' } }));
    fireEvent.click(solveButton());
    await waitFor(() => expect(location.hash).toMatch(/^#\/p\//));
    const [rec] = await listPuzzles();
    expect(rec.thumbnail).toMatch(/^data:/);
    expect(visionMocks.closeSession).toHaveBeenCalledWith(7);
  });

  test('strip failure: editor still works without images', async () => {
    visionMocks.stripsAsync.mockRejectedValue(new Error('boom'));
    const c = await pickAndConfirm();
    await screen.findByLabelText('Row 2');
    expect(c.querySelectorAll('.clue-line img')).toHaveLength(0);
  });

  test('unmount revokes the strip URLs', async () => {
    await pickAndConfirm();
    await screen.findByLabelText('Row 2');
    cleanup(); await new Promise((r) => setTimeout(r, 20));
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(5);
  });
});
