import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Puzzle } from '../core/types';
import type { Hint } from '../core/hint';
import { findMistakes } from '../core/check';
import { hintText, mistakesText } from '../core/text';
import { hintAsync } from '../worker/client';
import { setTime } from './DebugTimes';

export type Highlight = { cells: number[]; color: string } | null;

/** Levels that say something new; past this the "more" button is gone. */
function hintLevels(h: Hint): 1 | 2 | 3 {
  if (h.kind === 'done') return 1;
  if (h.kind === 'line' || h.kind === 'probe') return 3;
  return 2;
}

function hintCells(h: Hint): number[] {
  if (h.kind === 'line' || h.kind === 'conflict' || h.kind === 'ambiguous') return h.cells;
  if (h.kind === 'probe' || h.kind === 'reveal') return [h.cell];
  return [];
}

/**
 * Mistakes and hint for one checked set of marks. Re-mount it when the marks change:
 * every level is shown only after its own tap.
 */
export function ResultPanel(props: {
  puzzle: Puzzle; marks: Uint8Array; reference: Uint8Array;
  onHighlight: (h: Highlight) => void;
}) {
  const { puzzle, marks, reference, onHighlight } = props;
  const mistakes = useMemo(() => findMistakes(puzzle, marks, reference), [puzzle, marks, reference]);
  const [mLevel, setMLevel] = useState(0);
  const [hint, setHint] = useState<Hint | null>(null);
  const [hLevel, setHLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const highlight: Highlight = mLevel === 3 ? { cells: mistakes.cells, color: 'var(--error)' }
    : hint && hLevel >= 2 ? { cells: hintCells(hint), color: 'var(--accent)' }
    : null;
  const key = highlight ? `${highlight.color}:${highlight.cells.join(',')}` : '';
  useEffect(() => { onHighlight(highlight); }, [key]);
  useEffect(() => () => onHighlight(null), []);

  const askHint = async () => {
    if (busy) return;
    // Only now, on request, say that mistakes block the hint (no count, no cells).
    if (mistakes.cells.length > 0) { setBlocked(true); return; }
    setBusy(true);
    setError('');
    try {
      const r = await hintAsync(puzzle, marks, reference);
      setTime('hint', r.ms);
      if (!mounted.current) return;
      setHint(r.hint);
      setHLevel(1);
    } catch (e) {
      if (mounted.current) setError(`Could not find a hint: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const hasMistakes = mistakes.cells.length > 0;
  const hintMax = hint ? hintLevels(hint) : 0;
  const hintLines = hint ? ([1, 2, 3] as const).slice(0, Math.min(hLevel, hintMax)).map((l) => hintText(puzzle, hint, l)) : [];

  return (
    <section class="results" aria-label="Results">
      <div class="result-block">
        {mLevel === 0 && <button type="button" class="secondary" onClick={() => setMLevel(1)}>Mistakes</button>}
        {mLevel >= 1 && <p role="status">{mistakesText(puzzle, mistakes, 1)}</p>}
        {mLevel >= 2 && <p>{mistakesText(puzzle, mistakes, 2)}</p>}
        {mLevel === 1 && hasMistakes && (
          <button type="button" class="secondary" onClick={() => setMLevel(2)}>Which rows and columns?</button>
        )}
        {mLevel === 2 && (
          <button type="button" class="secondary" onClick={() => setMLevel(3)}>Show them on the grid</button>
        )}
      </div>

      <div class="result-block">
        {!hint && (
          <>
            <button type="button" class="secondary" disabled={busy} onClick={askHint}>Hint</button>
            {blocked && <p role="status">Fix the mistakes first.</p>}
            {busy && <p class="hint">Thinking…</p>}
          </>
        )}
        {error && <p class="error">{error}</p>}
        {hintLines.map((t, i) => <p key={i}>{t}</p>)}
        {hint && hLevel === 1 && hintMax >= 2 && (
          <button type="button" class="secondary" onClick={() => setHLevel(2)}>Which cells?</button>
        )}
        {hint && hLevel === 2 && hintMax >= 3 && (
          <button type="button" class="secondary" onClick={() => setHLevel(3)}>Why?</button>
        )}
      </div>
    </section>
  );
}
