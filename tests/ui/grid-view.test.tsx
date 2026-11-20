// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { FILLED } from '../../src/core/types';
import { GridView } from '../../src/ui/GridView';

const W = 25;
const mount = (p: Partial<Parameters<typeof GridView>[0]> = {}) =>
  render(<GridView width={W} height={2} cells={new Uint8Array(W * 2)} onTap={() => {}} {...p} />);
const cellPx = (c: Element) => parseFloat((c.querySelector('.grid') as HTMLElement).style.getPropertyValue('--cell'));
const at = (c: Element, i: number) => c.querySelector(`[data-cell="${i}"]`) as HTMLElement;

beforeEach(() => { (window as { innerWidth: number }).innerWidth = 400; });
afterEach(cleanup);

it('starts fitted to the width, and Zoom toggles 28px cells', () => {
  const { container } = mount();
  expect(cellPx(container)).toBeLessThanOrEqual(400 / W);
  expect(cellPx(container) * W).toBeLessThanOrEqual(368);
  fireEvent.click(screen.getByRole('button', { name: 'Zoom' }));
  expect(cellPx(container)).toBeGreaterThanOrEqual(28);
  fireEvent.click(screen.getByRole('button', { name: 'Zoom' }));
  expect(cellPx(container)).toBeLessThanOrEqual(400 / W);
});

it('double-tap toggles zoom and taps nothing, with no callback wiring', () => {
  vi.useFakeTimers();
  const onTap = vi.fn();
  const { container } = mount({ onTap });
  fireEvent.click(at(container, 3), { detail: 1 });
  fireEvent.click(at(container, 3), { detail: 2 });
  vi.advanceTimersByTime(1000);
  expect(onTap).not.toHaveBeenCalled();
  expect(cellPx(container)).toBeGreaterThanOrEqual(28);
  vi.useRealTimers();
});

it('a single tap applies after the short wait; keyboard click applies at once', () => {
  vi.useFakeTimers();
  const onTap = vi.fn();
  const { container } = mount({ onTap });
  fireEvent.click(at(container, 3), { detail: 1 });
  expect(onTap).not.toHaveBeenCalled();
  vi.advanceTimersByTime(250);
  expect(onTap).toHaveBeenCalledWith(3);
  fireEvent.click(at(container, 4), { detail: 0 });
  expect(onTap).toHaveBeenCalledWith(4);
  vi.useRealTimers();
});

it('quick taps on two different cells both apply', () => {
  vi.useFakeTimers();
  const onTap = vi.fn();
  const { container } = mount({ onTap });
  fireEvent.click(at(container, 3), { detail: 1 });
  fireEvent.click(at(container, 4), { detail: 2 });
  vi.advanceTimersByTime(1000);
  expect(onTap.mock.calls).toEqual([[3], [4]]);
  expect(cellPx(container)).toBeLessThanOrEqual(400 / W);
  vi.useRealTimers();
});

it('ringed cells get class ring', () => {
  const { container } = mount({ ringed: new Set([2]) });
  expect(at(container, 2).classList.contains('ring')).toBe(true);
  expect(at(container, 1).classList.contains('ring')).toBe(false);
});

it('focus zooms in and scrolls that cell into view', () => {
  const spy = vi.fn();
  Element.prototype.scrollIntoView = spy;
  const { container } = mount({ focus: 7, cells: Uint8Array.from({ length: W * 2 }, () => FILLED) });
  expect(cellPx(container)).toBeGreaterThanOrEqual(28);
  expect(spy.mock.contexts[0]).toBe(at(container, 7));
});
