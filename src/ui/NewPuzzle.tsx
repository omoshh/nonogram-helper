import { useEffect, useRef, useState } from 'preact/hooks';
import type { Puzzle } from '../core/types';
import { KNOWN_SIZES, parseClueLine } from '../core/clues';
import { putPuzzle } from '../store/db';
import { SolveFlow } from './SolveFlow';
import type { Draft } from './ClueEditor';
import { PhotoPick } from './PhotoPick';
import { GridCheck } from './GridCheck';
import { closeSession, stripsAsync } from '../worker/visionClient';

type Strips = { rows: string[]; cols: string[] };

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

const DRAFT_KEY = 'nonogram-new-draft';
type SavedDraft = Draft & { width: number; height: number };

function loadDraft(): SavedDraft | null {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null');
    const strings = (a: unknown, n: number) => Array.isArray(a) && a.length === n && a.every((x) => typeof x === 'string');
    const ok = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_SIDE;
    if (d && ok(d.width) && ok(d.height) && strings(d.rows, d.height) && strings(d.cols, d.width)
      && Array.isArray(d.givens) && d.givens.every((g: unknown) => Number.isInteger(g) && (g as number) >= 0 && (g as number) < d.width * d.height)) return d;
  } catch { /* unavailable or damaged: start fresh */ }
  return null;
}
const saveDraft = (d: SavedDraft) => { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* ignore */ } };
const clearDraft = () => { try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };

const typedAnything = (d: Draft) => d.givens.length > 0 || [...d.rows, ...d.cols].some((t) => t.trim() !== '');

/** A draft's clues as a puzzle; fields that do not parse stay empty (the editor keeps their text). */
function draftPuzzle(d: SavedDraft): Puzzle {
  const line = (t: string) => parseClueLine(t) ?? [];
  return { width: d.width, height: d.height, rows: d.rows.map(line), cols: d.cols.map(line), givens: d.givens };
}

export function NewPuzzle(props: { debug: boolean }) {
  const [sizeChoice, setSizeChoice] = useState(DEFAULT_SIZE);
  const [w, setW] = useState('');
  const [h, setH] = useState('');
  const [fixtureError, setFixtureError] = useState('');

  const [restored] = useState(loadDraft);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(() => (restored ? draftPuzzle(restored) : null));
  const [editorKey, setEditorKey] = useState(0);
  const latest = useRef<Draft | null>(restored);

  // Photo flow: the picked file, the cut strips (object URLs) and the vision session.
  const [photo, setPhoto] = useState<File | null>(null);
  const [cutting, setCutting] = useState(false);
  const [strips, setStrips] = useState<Strips | null>(null);
  const sessionId = useRef<number | null>(null);
  const urls = useRef<string[]>([]);
  const alive = useRef(true);
  const dropPhoto = () => {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current = [];
    if (sessionId.current !== null) closeSession(sessionId.current);
    sessionId.current = null;
    setStrips(null);
  };
  useEffect(() => () => { alive.current = false; dropPhoto(); }, []);

  const confirmGrid = async (r: { sessionId: number; geometry: { width: number; height: number } }) => {
    sessionId.current = r.sessionId;
    setCutting(true);
    try {
      const s = await stripsAsync(r.sessionId, r.geometry as never, 40);
      if (!alive.current) return; // left the screen meanwhile; the session is already closed
      const url = (b: Blob) => { const u = URL.createObjectURL(b); urls.current.push(u); return u; };
      setStrips({ rows: s.rows.map(url), cols: s.cols.map(url) });
    } catch { /* no strips: the clues can still be typed */ }
    if (!alive.current) return;
    setCutting(false);
    setPhoto(null);
    start(blank(r.geometry.width, r.geometry.height));
  };

  const start = (p: Puzzle) => {
    clearDraft();
    latest.current = null;
    setPuzzle(p);
    setEditorKey((k) => k + 1);
  };

  if (!puzzle && photo) {
    if (cutting) return <main><p class="hint" role="status">Cutting out the clues…</p></main>;
    return <GridCheck file={photo} onConfirm={confirmGrid} onCancel={() => setPhoto(null)} />;
  }

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
        <PhotoPick label="From photo" onFile={setPhoto} />
        <h3>Type clues</h3>
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

  const save = async (solved: Puzzle, status: 'unique' | 'multiple', reference: Uint8Array, timedOut: boolean) => {
    const id = crypto.randomUUID();
    await putPuzzle({ id, ...solved, answerDigits: [], reference, status, createdAt: new Date().toISOString(), ...(timedOut ? { timedOut } : {}) });
    clearDraft();
    dropPhoto();
    return `#/p/${id}`;
  };

  const changeSize = () => {
    if (latest.current && typedAnything(latest.current) && !window.confirm('Discard the clues you typed?')) return;
    clearDraft();
    dropPhoto();
    latest.current = null;
    setPuzzle(null);
  };
  const onDraft = (d: Draft) => {
    latest.current = d;
    saveDraft({ ...d, width: puzzle.width, height: puzzle.height });
  };

  return (
    <main>
      <h2>New puzzle {puzzle.width} × {puzzle.height}</h2>
      <button type="button" class="link" onClick={changeSize}>Change size (clears the clues)</button>
      <SolveFlow key={editorKey} initial={puzzle} initialDraft={restored && editorKey === 0 ? restored : undefined} onDraft={onDraft} save={save} strips={strips ?? undefined} />
    </main>
  );
}
