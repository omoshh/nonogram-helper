import { useEffect, useRef, useState } from 'preact/hooks';
import type { LineRef, Puzzle } from '../core/types';
import { KNOWN_SIZES } from '../core/clues';
import { validate, issueLines, type Issue } from '../core/validate';
import { solveAsync } from '../worker/client';
import { putPuzzle } from '../store/db';
import { ClueEditor, lineName } from './ClueEditor';
import { setTime } from './DebugTimes';

const sizeKey = (w: number, h: number) => `${w}x${h}`;
const DEFAULT_SIZE = sizeKey(25, 30);
const MAX_SIDE = 80;

function issueText(i: Issue): string {
  if (i.kind === 'sum-mismatch') return `Row sums ${i.rowSum}, column sums ${i.colSum}.`;
  if (i.kind === 'line-too-long') return `${lineName(i.line)} needs ${i.need} cells but has ${i.length}.`;
  return `${lineName(i.line)} does not fit its givens.`;
}

const blank = (w: number, h: number): Puzzle => ({
  width: w, height: h,
  rows: Array.from({ length: h }, () => []),
  cols: Array.from({ length: w }, () => []),
  givens: [],
});

/** Dev helper: a fixture JSON ({width, height, rows, cols, givens?}) → puzzle, or an error text. */
function parseFixture(text: string): Puzzle | string {
  try {
    const d = JSON.parse(text);
    const ok = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_SIDE;
    if (!ok(d.width) || !ok(d.height) || d.rows?.length !== d.height || d.cols?.length !== d.width) {
      return 'Needs width, height, rows and cols.';
    }
    return { width: d.width, height: d.height, rows: d.rows, cols: d.cols, givens: d.givens ?? [] };
  } catch {
    return 'Not valid JSON.';
  }
}

/** saveAnyway holds the puzzle that was solved, never the live (maybe edited) one. */
type Outcome = { text: string[]; saveAnyway?: { puzzle: Puzzle; reference: Uint8Array } };

export function NewPuzzle(props: { debug: boolean }) {
  const [sizeChoice, setSizeChoice] = useState(DEFAULT_SIZE);
  const [w, setW] = useState('');
  const [h, setH] = useState('');
  const [fixtureError, setFixtureError] = useState('');

  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [invalid, setInvalid] = useState(0);
  const [flagged, setFlagged] = useState<LineRef[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  // Bumped on every edit, size change and unmount: a solve result from an older generation is dropped.
  const generation = useRef(0);
  const solving = useRef(false);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; generation.current++; }, []);
  const invalidate = () => { generation.current++; setOutcome(null); };

  const start = (p: Puzzle) => {
    generation.current++;
    setPuzzle(p);
    setEditorKey((k) => k + 1);
    setFlagged([]);
    setOutcome(null);
  };

  if (!puzzle) {
    const custom = sizeChoice === 'custom';
    const cw = Number(w), ch = Number(h);
    const customOk = [cw, ch].every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_SIDE);
    const next = () => {
      if (!custom) {
        const [a, b] = sizeChoice.split('x').map(Number);
        start(blank(a, b));
      } else if (customOk) start(blank(cw, ch));
    };
    return (
      <main>
        <h2>New puzzle</h2>
        <p class="hint">Size is width × height (columns × rows).</p>
        <div class="field">
          <label for="size">Size</label>
          <select id="size" value={sizeChoice} onChange={(e) => setSizeChoice((e.target as HTMLSelectElement).value)}>
            {KNOWN_SIZES.map((s) => (
              <option key={sizeKey(s.width, s.height)} value={sizeKey(s.width, s.height)}>{s.width} × {s.height}</option>
            ))}
            <option value="custom">Other size</option>
          </select>
        </div>
        {custom && (
          <div class="field-row">
            <div class="field">
              <label for="width">Width</label>
              <input id="width" type="number" inputMode="numeric" min={1} max={MAX_SIDE} value={w}
                onInput={(e) => setW((e.target as HTMLInputElement).value)} />
            </div>
            <div class="field">
              <label for="height">Height</label>
              <input id="height" type="number" inputMode="numeric" min={1} max={MAX_SIDE} value={h}
                onInput={(e) => setH((e.target as HTMLInputElement).value)} />
            </div>
          </div>
        )}
        {custom && !customOk && (w || h) && <p class="error">Width and height must be 1 to {MAX_SIDE}.</p>}
        <button type="button" class="primary" disabled={custom && !customOk} onClick={next}>Enter clues</button>

        {props.debug && (
          <div class="field debug-paste">
            <label for="fixture">Paste puzzle JSON</label>
            <textarea id="fixture" rows={4} onInput={(e) => {
              const r = parseFixture((e.target as HTMLTextAreaElement).value);
              if (typeof r === 'string') setFixtureError(r);
              else { setFixtureError(''); start(r); }
            }} />
            {fixtureError && <p class="error">{fixtureError}</p>}
          </div>
        )}
      </main>
    );
  }

  const save = async (solved: Puzzle, status: 'unique' | 'multiple', reference: Uint8Array) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const id = crypto.randomUUID();
      await putPuzzle({
        id, ...solved, answerDigits: [], reference, status, createdAt: new Date().toISOString(),
      });
      if (mounted.current) location.hash = `#/p/${id}`;
    } catch (e) {
      if (mounted.current) setOutcome({ text: [`Could not save: ${e instanceof Error ? e.message : String(e)}`] });
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const runSolve = async () => {
    if (solving.current || savingRef.current) return;
    const solved = puzzle;
    const issues = validate(solved);
    if (issues.length > 0) {
      setFlagged(issueLines(issues));
      setOutcome({ text: issues.map(issueText) });
      return;
    }
    solving.current = true;
    setBusy(true);
    setOutcome({ text: ['Solving…'] });
    const gen = generation.current;
    try {
      const r = await solveAsync(solved);
      setTime('solve', r.ms);
      if (gen !== generation.current) return; // clues changed or screen left meanwhile
      if (r.timedOut && r.reference) {
        setFlagged([]);
        setOutcome({ text: ['The solver ran out of time. The puzzle may still be correct.'], saveAnyway: { puzzle: solved, reference: r.reference } });
      } else if (r.status === 'unique' && r.reference) {
        await save(solved, 'unique', r.reference);
      } else if (r.status === 'none') {
        setFlagged(r.suspect);
        setOutcome({ text: ['No solution. Some clues are probably wrong.'] });
      } else {
        setFlagged(r.suspect);
        setOutcome({
          text: ['More than one solution. Some clues are probably wrong, or a given is missing.'],
          saveAnyway: r.reference ? { puzzle: solved, reference: r.reference } : undefined,
        });
      }
    } catch (e) {
      if (gen === generation.current) setOutcome({ text: [`Could not solve: ${e instanceof Error ? e.message : String(e)}`] });
    } finally {
      solving.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <main>
      <h2>New puzzle {puzzle.width} × {puzzle.height}</h2>
      <button type="button" class="link" onClick={() => { generation.current++; setPuzzle(null); }}>Change size (clears the clues)</button>
      <p class="hint">Type the numbers of each line separated by space, dot or comma. Leave empty for a blank line.</p>
      {/* Any typing, even invalid text, makes a running solve stale. */}
      <div onInput={invalidate}>
      <ClueEditor
        key={editorKey}
        width={puzzle.width}
        height={puzzle.height}
        rows={puzzle.rows}
        cols={puzzle.cols}
        givens={puzzle.givens}
        flagged={flagged}
        onChange={(next) => { setPuzzle({ ...puzzle, ...next }); invalidate(); }}
        onInvalidChange={setInvalid}
      />
      </div>
      <div class="solve-bar">
        {outcome && (
          <div class="outcome" role="status">
            {outcome.text.map((t) => <p key={t}>{t}</p>)}
            {outcome.saveAnyway && invalid === 0 && (
              <button type="button" class="secondary" disabled={saving}
                onClick={() => save(outcome.saveAnyway!.puzzle, 'multiple', outcome.saveAnyway!.reference)}>
                Save anyway
              </button>
            )}
          </div>
        )}
        {invalid > 0 && <p class="error">{invalid === 1 ? '1 line is' : `${invalid} lines are`} not valid. Use only numbers.</p>}
        <button type="button" class="primary" disabled={busy || saving || invalid > 0} onClick={runSolve}>Solve</button>
      </div>
    </main>
  );
}
