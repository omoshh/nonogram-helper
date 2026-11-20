// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { ClueEditor } from '../../src/ui/ClueEditor';

afterEach(cleanup);

it('a double-tap on a given-grid cell does not change the givens', () => {
  vi.useFakeTimers();
  const onChange = vi.fn();
  const { container } = render(
    <ClueEditor width={5} height={5} rows={Array(5).fill([1])} cols={Array(5).fill([1])} givens={[]} flagged={[]} onChange={onChange} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Givens/ }));
  const cell = container.querySelector('[data-cell="2"]') as Element;
  fireEvent.click(cell, { detail: 1 });
  fireEvent.click(cell, { detail: 2 });
  vi.advanceTimersByTime(1000);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(cell, { detail: 1 });
  vi.advanceTimersByTime(250);
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ givens: [2] }));
  vi.useRealTimers();
});
