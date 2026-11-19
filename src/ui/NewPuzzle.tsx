import { useState } from 'preact/hooks';
import type { Puzzle } from '../core/types';
import { KNOWN_SIZES } from '../core/clues';
import { putPuzzle } from '../store/db';
import { SolveFlow } from './SolveFlow';

const sizeKey = (w: number, h: number) => `${w}x${h}`;
const DEFAULT_SIZE = sizeKey(25, 30);
const MAX_SIDE = 80;

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

export function NewPuzzle(props: { debug: boolean }) {
  const [sizeChoice, setSizeChoice] = useState(DEFAULT_SIZE);
  const [w, setW] = useState('');
  const [h, setH] = useState('');
  const [fixtureError, setFixtureError] = useState('');

  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [editorKey, setEditorKey] = useState(0);

  const start = (p: Puzzle) => {
    setPuzzle(p);
    setEditorKey((k) => k + 1);
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
    const id = crypto.randomUUID();
    await putPuzzle({ id, ...solved, answerDigits: [], reference, status, createdAt: new Date().toISOString() });
    return `#/p/${id}`;
  };

  return (
    <main>
      <h2>New puzzle {puzzle.width} × {puzzle.height}</h2>
      <button type="button" class="link" onClick={() => setPuzzle(null)}>Change size (clears the clues)</button>
      <SolveFlow key={editorKey} initial={puzzle} save={save} />
    </main>
  );
}
