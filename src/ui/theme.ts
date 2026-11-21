export type Theme = 'light' | 'dark';

const KEY = 'theme';
/** The browser bar colour: the paper of each theme. */
const BAR: Record<Theme, string> = { light: '#F4EEE2', dark: '#1A1A1A' };

/** The saved theme; light when nothing is saved or storage is blocked. */
export function savedTheme(): Theme {
  try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
}

/** Shows the theme now and keeps it for the next visit. */
export function applyTheme(t: Theme, save = true): void {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[t]);
  if (save) try { localStorage.setItem(KEY, t); } catch { /* private mode: this visit only */ }
}
