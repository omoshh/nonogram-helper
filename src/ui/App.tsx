import { useEffect, useRef, useState } from 'preact/hooks';
import { PuzzleList } from './PuzzleList';
import { NewPuzzle } from './NewPuzzle';
import { PuzzlePage } from './PuzzlePage';
import { EditClues } from './EditClues';
import { CheckPage } from './CheckPage';
import { DebugTimes } from './DebugTimes';
import { applyTheme, savedTheme, type Theme } from './theme';

function useHash(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => { setHash(location.hash); window.scrollTo?.(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const [debug, setDebug] = useState(false);
  const [theme, setTheme] = useState(savedTheme);
  useEffect(() => applyTheme(theme, false), []);
  const pickTheme = (t: Theme) => { applyTheme(t); setTheme(t); };
  const taps = useRef({ n: 0, last: 0 });

  const tapTitle = () => {
    const now = Date.now();
    const t = taps.current;
    t.n = now - t.last < 1500 ? t.n + 1 : 1;
    t.last = now;
    if (t.n >= 5) { t.n = 0; setDebug(!debug); }
  };

  const puzzleRoute = hash.match(/^#\/p\/([^/]+)(?:\/(clues|check))?$/);
  let page;
  if (hash === '#/new') page = <NewPuzzle debug={debug} />;
  else if (puzzleRoute) {
    const id = decodeURIComponent(puzzleRoute[1]);
    if (puzzleRoute[2] === 'clues') page = <EditClues key={id} id={id} />;
    else if (puzzleRoute[2] === 'check') page = <CheckPage key={id} id={id} />;
    else page = <PuzzlePage key={id} id={id} />;
  }
  else page = <PuzzleList />;

  return (
    <>
      <header class="app-header">
        <h1 onClick={tapTitle}>Nonogram Helper</h1>
        <nav>
          <div class="theme-switch" role="group" aria-label="Theme">
            {(['light', 'dark'] as const).map((t) => (
              <button type="button" key={t} aria-pressed={theme === t} onClick={() => pickTheme(t)}>{t}</button>
            ))}
          </div>
          {hash !== '' && hash !== '#/' && <a href="#/">List</a>}
        </nav>
      </header>
      {page}
      {debug && <DebugTimes />}
    </>
  );
}
