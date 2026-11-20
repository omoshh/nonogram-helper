import { useMemo, useRef, useState } from 'preact/hooks';
import { UNKNOWN, FILLED, EMPTY, type Cell } from '../core/types';
import type { PuzzleRecord } from '../store/db';
import { GridView } from './GridView';

export const CYCLE: Record<number, Cell> = { [UNKNOWN]: FILLED, [FILLED]: EMPTY, [EMPTY]: UNKNOWN };
const SET: { cell: Cell; label: string }[] = [
  { cell: FILLED, label: 'Filled' }, { cell: EMPTY, label: 'Dot' }, { cell: UNKNOWN, label: 'Unknown' },
];
const TAP_WAIT_MS = 270; // a bit over GridView's double-tap window: a tap just before "Check" lands first

export function MarksReview(props: {
  rec: PuzzleRecord; cells: Uint8Array; unsure: number[]; retake: boolean; views: string[];
  onDone: (marks: Uint8Array<ArrayBuffer>) => void; onCancel: () => void;
}) {
  const { rec, unsure, views } = props;
  const givens = useMemo(() => new Set(rec.givens), [rec]);
  const ringed = useMemo(() => new Set(unsure), [unsure]);
  const [marks, setMarks] = useState(() => new Uint8Array(props.cells));
  const latest = useRef(marks);
  const [at, setAt] = useState(0);
  const [seen, setSeen] = useState(() => new Set([0]));
  const [stepped, setStepped] = useState(false); // opens fitted; zooms to the cell only after a step
  const n = unsure.length;
  const current = n ? unsure[at] : undefined;

  const put = (cell: number, v: (old: number) => number) => {
    if (givens.has(cell)) return; // printed filled
    const next = new Uint8Array(latest.current);
    next[cell] = v(next[cell]);
    latest.current = next;
    setMarks(next);
  };
  const go = (to: number) => { setAt(to); setSeen(new Set(seen).add(to)); setStepped(true); };
  const done = () => setTimeout(() => props.onDone(latest.current), TAP_WAIT_MS);

  return (
    <main>
      {props.retake && <p>Part of the page is in shadow or blurred. A new photo will read better.</p>}
      <h2>{n === 1 ? '1 cell to check' : `${n} cells to check`}</h2>
      {n > 0 && (
        <>
          <div class="mode-switch">
            <button type="button" aria-label="Previous" disabled={at === 0} onClick={() => go(at - 1)}>◀</button>
            <span>{at + 1}/{n}</span>
            <button type="button" aria-label="Next" disabled={at === n - 1} onClick={() => go(at + 1)}>▶</button>
          </div>
          <img src={views[at]} alt="The cell in the photo" style="max-width: 100%" />
          <div class="mode-switch" role="group" aria-label="This cell is">
            {SET.map((s) => (
              <button type="button" key={s.label} aria-pressed={marks[current!] === s.cell}
                onClick={() => put(current!, () => s.cell)}>{s.label}</button>
            ))}
          </div>
        </>
      )}
      <GridView width={rec.width} height={rec.height} cells={marks} rows={rec.rows} cols={rec.cols}
        givens={givens} ringed={ringed} focus={stepped ? current : undefined} onTap={(c) => put(c, (o) => CYCLE[o])} />
      <div class="solve-bar">
        <button type="button" onClick={props.onCancel}>Cancel</button>
        <button type="button" class="primary" disabled={seen.size < n} onClick={done}>Check</button>
      </div>
    </main>
  );
}
