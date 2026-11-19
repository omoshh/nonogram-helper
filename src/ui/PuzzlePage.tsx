import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Puzzle } from '../core/types';
import { deletePuzzle, getPuzzle, journalNames, putPuzzle, type PuzzleRecord } from '../store/db';
import { GridView } from './GridView';

/** undefined while loading, null when missing. */
export function usePuzzleRecord(id: string): PuzzleRecord | null | undefined {
  const [rec, setRec] = useState<PuzzleRecord | null | undefined>(undefined);
  useEffect(() => { getPuzzle(id).then((r) => setRec(r ?? null), () => setRec(null)); }, [id]);
  return rec;
}

export const toPuzzle = (r: PuzzleRecord): Puzzle =>
  ({ width: r.width, height: r.height, rows: r.rows, cols: r.cols, givens: r.givens });

/** Loading / not found states shared by the puzzle screens. */
export function RecordGate(props: { rec: PuzzleRecord | null | undefined; children: (r: PuzzleRecord) => ComponentChildren }) {
  if (props.rec === undefined) return <main><p class="hint">Loading…</p></main>;
  if (props.rec === null) return <main><a href="#/">← All puzzles</a><p>Puzzle not found.</p></main>;
  return <>{props.children(props.rec)}</>;
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const MULTIPLE_NOTE = 'This puzzle has more than one solution. Only cells that are the same in all solutions are checked.';

function Details(props: { initial: PuzzleRecord }) {
  const [rec, setRec] = useState(props.initial);
  const [names, setNames] = useState<string[]>([]);
  const [showSolution, setShowSolution] = useState(false);
  const [error, setError] = useState('');
  // Writes run one after another so a slow older write never overwrites a newer one.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => { journalNames().then(setNames, () => {}); }, []);

  const update = (patch: Partial<PuzzleRecord>) => {
    const next = { ...rec, ...patch };
    setRec(next);
    queue.current = queue.current
      .then(() => putPuzzle(next))
      .then(() => setError(''), (e) => setError(`Could not save: ${e instanceof Error ? e.message : String(e)}`));
  };
  const text = (v: string) => (v.trim() === '' ? undefined : v);

  const askSolution = () => { if (window.confirm('Show the full solution?')) setShowSolution(true); };
  const remove = async () => {
    if (!window.confirm('Delete this puzzle?')) return;
    try {
      await deletePuzzle(rec.id);
      location.hash = '#/';
    } catch (e) {
      setError(`Could not delete: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <main>
      <a href="#/">← All puzzles</a>
      <h2>Puzzle {rec.width} × {rec.height}</h2>
      {rec.status === 'multiple' && <p class="message">{MULTIPLE_NOTE}</p>}
      {error && <p class="error" role="alert">{error}</p>}

      <a class="button primary" href={`#/p/${rec.id}/check`}>Check my grid</a>

      <div class="field">
        <label for="journal">Journal</label>
        <input id="journal" type="text" list="journal-names" autoComplete="off" value={rec.journal ?? ''}
          onInput={(e) => update({ journal: text((e.target as HTMLInputElement).value) })} />
        <datalist id="journal-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
      </div>
      <div class="field">
        <label for="page">Page</label>
        <input id="page" type="text" inputMode="numeric" autoComplete="off" value={rec.page ?? ''}
          onInput={(e) => update({ page: text((e.target as HTMLInputElement).value) })} />
      </div>
      <div class="field">
        <label for="solved">Solved on</label>
        <input id="solved" type="date" value={rec.solvedDate ?? ''}
          onChange={(e) => update({ solvedDate: text((e.target as HTMLInputElement).value) })} />
        <div class="button-row">
          <button type="button" class="secondary" onClick={() => update({ solvedDate: today() })}>Mark as solved</button>
          <button type="button" class="secondary" disabled={!rec.solvedDate} onClick={() => update({ solvedDate: undefined })}>Clear date</button>
        </div>
      </div>

      <div class="button-row">
        <a class="button secondary" href={`#/p/${rec.id}/clues`}>Edit clues</a>
        {!showSolution && <button type="button" class="secondary" onClick={askSolution}>Show solution</button>}
      </div>
      {showSolution && (
        <section aria-label="Solution">
          <h3>Solution</h3>
          <GridView width={rec.width} height={rec.height} cells={Uint8Array.from(rec.reference)} rows={rec.rows} cols={rec.cols} />
        </section>
      )}
      <button type="button" class="danger" onClick={remove}>Delete puzzle</button>
    </main>
  );
}

export function PuzzlePage(props: { id: string }) {
  const rec = usePuzzleRecord(props.id);
  return <RecordGate rec={rec}>{(r) => <Details key={r.id} initial={r} />}</RecordGate>;
}
