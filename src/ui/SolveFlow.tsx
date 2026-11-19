import { useEffect, useRef, useState } from 'preact/hooks';
import type { LineRef, Puzzle } from '../core/types';
import { validate, issueLines, type Issue } from '../core/validate';
import { solveAsync } from '../worker/client';
import { lineNameCap as lineName } from '../core/text';
import { ClueEditor, type Draft } from './ClueEditor';
import { setTime } from './DebugTimes';

function issueText(i: Issue): string {
  if (i.kind === 'sum-mismatch') return `Row sums ${i.rowSum}, column sums ${i.colSum}.`;
  if (i.kind === 'line-too-long') return `${lineName(i.line)} needs ${i.need} cells but has ${i.length}.`;
  return `${lineName(i.line)} does not fit its givens.`;
}

/** saveAnyway holds the puzzle that was solved, never the live (maybe edited) one. */
type Outcome = { text: string[]; saveAnyway?: { puzzle: Puzzle; reference: Uint8Array; timedOut: boolean } };

/**
 * Clue editor + Solve: validates, solves, and calls `save` only for a unique solution or "Save anyway".
 * `save` stores the record and returns the hash to open. Re-mount (key) to load other clues.
 */
export function SolveFlow(props: {
  initial: Puzzle;
  save: (solved: Puzzle, status: 'unique' | 'multiple', reference: Uint8Array, timedOut: boolean) => Promise<string>;
  /** Restored raw field text (a saved draft). */
  initialDraft?: Draft;
  /** Called with the raw field text whenever it changes. */
  onDraft?: (d: Draft) => void;
}) {
  const [puzzle, setPuzzle] = useState(props.initial);
  const [invalid, setInvalid] = useState(0);
  const [flagged, setFlagged] = useState<LineRef[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  // Bumped on every edit and on unmount: a solve result from an older generation is dropped.
  const generation = useRef(0);
  const solving = useRef(false);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; generation.current++; }, []);
  const invalidate = () => { generation.current++; setOutcome(null); };

  const save = async (solved: Puzzle, status: 'unique' | 'multiple', reference: Uint8Array, timedOut = false) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const next = await props.save(solved, status, reference, timedOut);
      if (mounted.current) location.hash = next;
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
        setOutcome({ text: ['The solver ran out of time. The puzzle may still be correct.'], saveAnyway: { puzzle: solved, reference: r.reference, timedOut: true } });
      } else if (r.status === 'unique' && r.reference) {
        await save(solved, 'unique', r.reference);
      } else if (r.status === 'none') {
        setFlagged(r.suspect);
        setOutcome({ text: ['No solution. Some clues are probably wrong.', ...(r.suspect.length === 0 ? ['No single line stands out; compare every line with the puzzle.'] : [])] });
      } else {
        setFlagged(r.suspect);
        setOutcome({
          text: ['More than one solution. Some clues are probably wrong, or a given is missing.'],
          saveAnyway: r.reference ? { puzzle: solved, reference: r.reference, timedOut: false } : undefined,
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
    <>
      <p class="hint">Type the numbers of each line separated by space, dot or comma. Leave empty for a blank line.</p>
      {/* Any typing, even invalid text, makes a running solve stale. */}
      <div onInput={invalidate}>
        <ClueEditor
          width={puzzle.width}
          height={puzzle.height}
          rows={puzzle.rows}
          cols={puzzle.cols}
          givens={puzzle.givens}
          initialText={props.initialDraft}
          onDraft={props.onDraft}
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
                onClick={() => save(outcome.saveAnyway!.puzzle, 'multiple', outcome.saveAnyway!.reference, outcome.saveAnyway!.timedOut)}>
                Save anyway
              </button>
            )}
          </div>
        )}
        {invalid > 0 && <p class="error">{invalid === 1 ? '1 line is' : `${invalid} lines are`} not valid. Use only numbers.</p>}
        <button type="button" class="primary" disabled={busy || saving || invalid > 0} onClick={runSolve}>Solve</button>
      </div>
    </>
  );
}
