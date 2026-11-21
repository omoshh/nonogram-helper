// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { App } from '../../src/ui/App';

beforeEach(() => { localStorage.clear(); delete document.documentElement.dataset.theme; location.hash = ''; });
afterEach(cleanup);

const dark = () => screen.getByRole('button', { name: 'dark' });
const light = () => screen.getByRole('button', { name: 'light' });

it('starts light when nothing is saved', () => {
  render(<App />);
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(dark().getAttribute('aria-pressed')).toBe('false');
  expect(light().getAttribute('aria-pressed')).toBe('true');
});

it('the toggle turns dark on and off and keeps the choice', () => {
  render(<App />);
  fireEvent.click(dark());
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem('theme')).toBe('dark');
  expect(dark().getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(light());
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(localStorage.getItem('theme')).toBe('light');
});

it('a saved dark choice comes back on the next visit', () => {
  localStorage.setItem('theme', 'dark');
  render(<App />);
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(dark().getAttribute('aria-pressed')).toBe('true');
});
