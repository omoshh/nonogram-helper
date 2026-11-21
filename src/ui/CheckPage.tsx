import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { UNKNOWN, FILLED, EMPTY, type Cell } from '../core/types';
import { putPuzzle, type PuzzleRecord } from '../store/db';
import { closeSession, readMarksAsync } from '../worker/visionClient';
import type { TableGeometry } from '../vision/mesh';
import { setTime } from './DebugTimes';
import { GridCheck } from './GridCheck';
import { GridView } from './GridView';
import { CYCLE, MarksReview } from './MarksReview';
import { PhotoPick } from './PhotoPick';
import { RecordGate, toPuzzle, usePuzzleRecord } from './PuzzlePage';
import { ResultPanel, type Highlight } from './ResultPanel';

type Mode = 'cycle' | Cell;
const MODES: { mode: Mode; label: string }[] = [
  { mode: 'cycle', label: 'Cycle' }, { mode: FILLED, label: 'Filled' },
  { mode: EMPTY, label: 'Dot' }, { mode: UNKNOWN, label: 'Clear' },
];

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
  const [photo, setPhoto] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [review, setReview] = useState<{ cells: Uint8Array; unsure: number[]; views: string[] } | null>(null);
  const open = useRef<{ session: number | null; urls: string[] }>({ session: null, urls: [] });
  const release = () => {
    if (open.current.session !== null) closeSession(open.current.session);
    open.current.session = null;
    open.current.urls.forEach((u) => URL.revokeObjectURL(u));
    open.current.urls = [];
  };
  useEffect(() => release, []);

  // The solution is never passed: only the photo session, the confirmed grid and the printed givens.
  const read = async (sessionId: number, g: TableGeometry) => {
    setPhoto(null);
    if (g.width !== rec.width || g.height !== rec.height) {
      closeSession(sessionId);
      setPhotoError(`This photo shows a ${g.width}×${g.height} grid; this puzzle is ${rec.width}×${rec.height}.`);
      return;
    }
    open.current.session = sessionId;
    setReading(true);
    try {
      const r = await readMarksAsync(sessionId, g, rec.givens);
      setTime('marks', r.ms);
      // A retake read can hold confident misreads (glare, deep shadow): never show it.
      if (r.retake) {
        setPhotoError('The marks cannot be read safely from this photo: part of the page is in shadow, glare or blur. Take a new photo.');
        return;
      }
      open.current.urls = r.views.map((b) => URL.createObjectURL(b));
      setReview({ cells: r.cells, unsure: r.unsure, views: open.current.urls });
    } catch (e) {
      setPhotoError(`Could not read the marks. (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      closeSession(sessionId);
      open.current.session = null;
      setReading(false);
    }
  };

  const tap = (cell: number) => {
    if (givens.has(cell)) return; // printed filled
    const next = marks.slice();
    next[cell] = mode === 'cycle' ? CYCLE[marks[cell]] : mode;
    if (next[cell] === marks[cell]) return;
    setMarks(next);
    setChecked(null);
  };

  const check = async (snapshot = marks) => {
    try {
      await putPuzzle({ ...rec, lastMarks: snapshot });
      setError('');
    } catch (e) {
      setError(`Could not save the marks: ${e instanceof Error ? e.message : String(e)}`);
    }
    setChecked(snapshot);
  };

  if (photo) return (
    <GridCheck file={photo} onCancel={() => setPhoto(null)} onConfirm={(r) => read(r.sessionId, r.geometry)}
      knownGrid={{ width: rec.width, height: rec.height, fallbackDepth: {
        colClueDepth: Math.max(1, ...rec.cols.map((c) => c.length)), rowClueDepth: Math.max(1, ...rec.rows.map((r) => r.length)) } }} />
  );
  if (reading) return <main><p>Reading the marks…</p></main>;
  if (review) return (
    <MarksReview rec={rec} {...review}
      onCancel={() => { release(); setReview(null); }}
      onDone={(m) => { release(); setReview(null); setMarks(m); check(m); }} />
  );

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
        givens={givens} marked={highlight ? new Set(highlight.cells) : undefined} markKind={highlight?.kind} markValues={highlight?.values} onTap={tap} />
      <PhotoPick label="Photo" onFile={(f) => { setPhotoError(''); setPhoto(f); }} />
      <p class="hint">Avoid the flashlight: daylight or a lamp from the side reads best.</p>
      {/* light-grey printed cells read as sure blanks when not saved as givens */}
      {!rec.givens.length && <p class="hint">Enter the printed cells first (Givens), or they can read as blank.</p>}
      {photoError && <p class="error" role="alert">{photoError}</p>}
      {error && <p class="error" role="alert">{error}</p>}
      {checked === marks
        ? <ResultPanel puzzle={puzzle} marks={checked} reference={reference} onHighlight={setHighlight} />
        : <div class="solve-bar"><button type="button" class="primary" onClick={() => check()}>Check</button></div>}
    </main>
  );
}

export function CheckPage(props: { id: string }) {
  const rec = usePuzzleRecord(props.id);
  return <RecordGate rec={rec}>{(r) => <MarksEditor key={r.id} rec={r} />}</RecordGate>;
}
