import { useEffect, useRef, useState } from 'preact/hooks';
import { getPuzzle, type PuzzleRecord } from '../store/db';
import { PuzzleList } from './PuzzleList';
import { NewPuzzle } from './NewPuzzle';
import { DebugTimes } from './DebugTimes';

function useHash(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => { setHash(location.hash); window.scrollTo?.(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

/** Placeholder until Task 10 builds the puzzle page, clue edit and check. */
function PuzzlePage(props: { id: string }) {
  const [rec, setRec] = useState<PuzzleRecord | null | undefined>(undefined);
  useEffect(() => { getPuzzle(props.id).then((r) => setRec(r ?? null)); }, [props.id]);
  return (
    <main>
      <a href="#/">← All puzzles</a>
      {rec === undefined ? <p class="hint">Loading…</p>
        : rec === null ? <p>Puzzle not found.</p>
        : <h2>Puzzle {rec.width} × {rec.height}</h2>}
    </main>
  );
}

export function App() {
  const hash = useHash();
  const [debug, setDebug] = useState(false);
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
  else if (puzzleRoute) page = <PuzzlePage id={decodeURIComponent(puzzleRoute[1])} />;
  else page = <PuzzleList />;

  return (
    <>
      <header class="app-header">
        <h1 onClick={tapTitle}>Nonogram Helper</h1>
        {hash !== '' && hash !== '#/' && <a href="#/">List</a>}
      </header>
      {page}
      {debug && <DebugTimes />}
    </>
  );
}
