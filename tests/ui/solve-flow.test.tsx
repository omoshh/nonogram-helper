// @vitest-environment happy-dom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/preact';
import type { LineRef, Puzzle } from '../../src/core/types';
import { solve } from '../../src/core/solver';
import { SolveFlow } from '../../src/ui/SolveFlow';

const { solveAsync } = vi.hoisted(() => ({ solveAsync: vi.fn() }));
vi.mock('../../src/worker/client', () => ({ solveAsync }));

const puzzle: Puzzle = { width: 5, height: 5, rows: Array(5).fill([5]), cols: Array(5).fill([5]), givens: [] };
const row = (index: number): LineRef => ({ axis: 'row', index });
const setup = (initialUnsure: LineRef[], onUnsure = vi.fn()) => {
  const save = vi.fn(async () => '#/');
  const r = render(<SolveFlow initial={puzzle} save={save} initialUnsure={initialUnsure} onUnsure={onUnsure} />);
  return { ...r, onUnsure };
};
const lineOf = (name: string) => (screen.getByLabelText(name) as HTMLElement).closest('.clue-line')!;

beforeEach(() => { solveAsync.mockImplementation(async (p: Puzzle) => solve(p)); });
afterEach(() => vi.unstubAllGlobals());
afterEach(cleanup);

it('unsure lines are marked with an OK button', () => {
  const { container } = setup([row(2)]);
  expect(lineOf('Row 3').classList.contains('unsure')).toBe(true);
  expect(container.querySelectorAll('.unsure').length).toBe(1);
  expect(screen.getByRole('button', { name: 'Row 3 is right' })).toBeTruthy();
  expect(screen.getByText('1 clue line is unsure — check the marked field against the photo.')).toBeTruthy();
});

it('OK clears the mark', () => {
  const { container, onUnsure } = setup([row(2)]);
  fireEvent.click(screen.getByRole('button', { name: 'Row 3 is right' }));
  expect(container.querySelector('.unsure')).toBeNull();
  expect(screen.queryByText(/unsure/)).toBeNull();
  expect(onUnsure).toHaveBeenLastCalledWith([]);
});

it('an edit clears the mark, also when typed back', () => {
  const { container } = setup([row(2)]);
  const input = screen.getByLabelText('Row 3') as HTMLInputElement;
  const old = input.value;
  fireEvent.input(input, { target: { value: '4' } });
  fireEvent.input(input, { target: { value: old } });
  expect(container.querySelector('.unsure')).toBeNull();
});

it('Solve with unsure lines asks first', async () => {
  setup([row(0), row(1)]);
  const confirm = vi.fn(() => false);
  vi.stubGlobal('confirm', confirm);
  fireEvent.click(screen.getByRole('button', { name: 'Solve' }));
  expect(confirm).toHaveBeenCalledWith('2 clue lines are not checked. Solve anyway?');
  expect(solveAsync).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Solve' }));
  await waitFor(() => expect(solveAsync).toHaveBeenCalledTimes(1));
});

it('a solve result does not clear unsure marks', async () => {
  vi.stubGlobal('confirm', () => true);
  solveAsync.mockResolvedValue({ status: 'none', suspect: [row(4)], ms: 1, timedOut: false });
  const { container } = setup([row(2)]);
  fireEvent.click(screen.getByRole('button', { name: 'Solve' }));
  await waitFor(() => expect(lineOf('Row 5').classList.contains('flagged')).toBe(true));
  expect(lineOf('Row 3').classList.contains('unsure')).toBe(true);
  expect(container.querySelectorAll('.unsure').length).toBe(1);
});
