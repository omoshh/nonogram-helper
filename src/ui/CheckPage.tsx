import { useMemo, useState } from 'preact/hooks';
import { UNKNOWN, FILLED, EMPTY, type Cell } from '../core/types';
import { putPuzzle, type PuzzleRecord } from '../store/db';
import { GridView } from './GridView';
import { RecordGate, toPuzzle, usePuzzleRecord } from './PuzzlePage';
import { ResultPanel, type Highlight } from './ResultPanel';

type Mode = 'cycle' | Cell;
const MODES: { mode: Mode; label: string }[] = [
  { mode: 'cycle', label: 'Cycle' }, { mode: FILLED, label: 'Filled' },
  { mode: EMPTY, label: 'Dot' }, { mode: UNKNOWN, label: 'Clear' },
];
const CYCLE: Record<number, Cell> = { [UNKNOWN]: FILLED, [FILLED]: EMPTY, [EMPTY]: UNKNOWN };

function MarksEditor(props: { rec: PuzzleRecord }) {
  const { rec } = props;
  const puzzle = useMemo(() => toPuzzle(rec), [rec]);
  const reference = useMemo(() => Uint8Array.from(rec.reference), [rec]);
  const givens = useMemo(() => new Set(rec.givens), [rec]);
  const [marks, setMarks] = useState(() => {
    const m = rec.lastMarks?.length === rec.width * rec.height
      ? Uint8Array.from(rec.lastMarks) : new Uint8Array(rec.width * rec.height);
    for (const g of rec.givens) m[g] = FILLED;
    return m;
  });
  const [mode, setMode] = useState<Mode>('cycle');
  // The marks that were checked; null hides the results until the next "Check".
  const [checked, setChecked] = useState<Uint8Array | null>(null);
  const [highlight, setHighlight] = useState<Highlight>(null);
  const [error, setError] = useState('');

  const tap = (cell: number) => {
    if (givens.has(cell)) return; // printed filled
    const next = marks.slice();
    next[cell] = mode === 'cycle' ? CYCLE[marks[cell]] : mode;
    if (next[cell] === marks[cell]) return;
    setMarks(next);
    setChecked(null);
  };

  const check = async () => {
    const snapshot = marks;
    try {
      await putPuzzle({ ...rec, lastMarks: snapshot });
      setError('');
    } catch (e) {
      setError(`Could not save the marks: ${e instanceof Error ? e.message : String(e)}`);
    }
    setChecked(snapshot);
  };

  return (
    <main>
      <a href={`#/p/${rec.id}`}>← Back to the puzzle</a>
      <h2>Check my grid</h2>
      <div class="mode-switch" role="group" aria-label="Tap sets">
        <span>Tap sets:</span>
        {MODES.map((m) => (
          <button type="button" key={m.label} aria-pressed={mode === m.mode} onClick={() => setMode(m.mode)}>{m.label}</button>
        ))}
      </div>
      <GridView width={rec.width} height={rec.height} cells={marks} rows={rec.rows} cols={rec.cols}
        marked={highlight ? new Set(highlight.cells) : undefined} markColor={highlight?.color} onTap={tap} />
      {error && <p class="error" role="alert">{error}</p>}
      {checked === marks
        ? <ResultPanel puzzle={puzzle} marks={checked} reference={reference} onHighlight={setHighlight} />
        : <div class="solve-bar"><button type="button" class="primary" onClick={check}>Check</button></div>}
    </main>
  );
}

export function CheckPage(props: { id: string }) {
  const rec = usePuzzleRecord(props.id);
  return <RecordGate rec={rec}>{(r) => <MarksEditor key={r.id} rec={r} />}</RecordGate>;
}
