import { useEffect, useRef, useState } from 'preact/hooks';
import type { Point } from '../vision/types';
import { crossing, type TableGeometry } from '../vision/mesh';
import { KNOWN_SIZES } from '../core/clues';
import { closeSession, detectPhoto, meshFromCornersAsync, rotateSession, type PhotoSession } from '../worker/visionClient';
import { setTime } from './DebugTimes';

type Known = { width: number; height: number; colClueDepth: number; rowClueDepth: number };
const DEFAULT: Known = { width: 25, height: 30, colClueDepth: 8, rowClueDepth: 8 }; // 25×30 is the most common size
const NAMES = ['Top-left corner', 'Top-right corner', 'Bottom-right corner', 'Bottom-left corner'];
const sizeKey = (w: number, h: number) => `${w}x${h}`;
// The real cause goes on screen: it is the only way to learn why a photo failed on the phone.
const why = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isKnown = (z: { width: number; height: number }) => KNOWN_SIZES.some((k) => k.width === z.width && k.height === z.height);
const MIN_SIDE = 1, MAX_SIDE = 50; // 50: the largest side detection has handled on real photos (cells ≈ 30 px)
const sideOk = (n: number) => Number.isInteger(n) && n >= MIN_SIDE && n <= MAX_SIDE;
const depthOk = (n: number) => Number.isInteger(n) && n >= 1;
const valid = (z: Known) => sideOk(z.width) && sideOk(z.height) && depthOk(z.colClueDepth) && depthOk(z.rowClueDepth);

const sizeOf = (g: TableGeometry): Known => ({ width: g.width, height: g.height, colClueDepth: g.colClueDepth, rowClueDepth: g.rowClueDepth });
const cornersOf = (g: TableGeometry): Point[] => [
  crossing(g, g.rowClueDepth, g.colClueDepth), crossing(g, g.cols, g.colClueDepth),
  crossing(g, g.cols, g.rows), crossing(g, g.rowClueDepth, g.rows),
];
const defaultCorners = (s: PhotoSession): Point[] => [
  { x: 0.15 * s.width, y: 0.15 * s.height }, { x: 0.85 * s.width, y: 0.15 * s.height },
  { x: 0.85 * s.width, y: 0.85 * s.height }, { x: 0.15 * s.width, y: 0.85 * s.height },
];
// Convex when every turn of the outline goes the same way.
function convex(c: Point[]): boolean {
  const t = c.map((p, i) => {
    const a = c[(i + 1) % 4], b = c[(i + 2) % 4];
    return (a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x);
  });
  return t.every((v) => v > 0) || t.every((v) => v < 0);
}

function draw(canvas: HTMLCanvasElement, s: PhotoSession, g: TableGeometry | null) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(s.preview, 0, 0);
  if (!g) return;
  const k = s.preview.width / s.width;
  // The found grid is the app's own mark on the photo: drawn in the hint ink, the clue area in a dashed line.
  const hint = getComputedStyle(canvas).getPropertyValue('--hint').trim() || '#00838A';
  const seg = (a: Point, b: Point, grid: boolean) => {
    ctx.strokeStyle = hint;
    ctx.setLineDash?.(grid ? [] : [4, 4]);
    ctx.beginPath(); ctx.moveTo(a.x * k, a.y * k); ctx.lineTo(b.x * k, b.y * k); ctx.stroke();
  };
  ctx.lineWidth = 2;
  for (let r = 0; r <= g.rows; r++) for (let c = 0; c <= g.cols; c++) {
    const grid = c >= g.rowClueDepth && r >= g.colClueDepth, p = crossing(g, c, r);
    if (r < g.rows) seg(p, crossing(g, c, r + 1), grid);
    if (c < g.cols) seg(p, crossing(g, c + 1, r), grid);
  }
}

export function GridCheck(props: {
  file: File;
  knownSize?: Known;
  /** The size is the puzzle's; depths come from the detection, else fallbackDepth. */
  knownGrid?: { width: number; height: number; fallbackDepth: { colClueDepth: number; rowClueDepth: number } };
  onConfirm: (r: { sessionId: number; geometry: TableGeometry }) => void;
  onCancel: () => void;
}) {
  const [session, setSession] = useState<PhotoSession | null>(null);
  const [corners, setCorners] = useState<Point[]>([]);
  const [size, setSize] = useState<Known>(DEFAULT);
  const [other, setOther] = useState(false);
  const [geometry, setGeometry] = useState<TableGeometry | null>(null);
  const [failed, setFailed] = useState(false);
  const [crossed, setCrossed] = useState(false);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0); // bumped by Try again: re-reads the same file
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0); // only the latest re-mesh may update the screen
  const sid = useRef<number | null>(null);
  // the handle being dragged: pointer id, handle centre minus pointer (CSS px), press position, corner before the drag
  const active = useRef<{ id: number; dx: number; dy: number; x0: number; y0: number; c0: Point } | null>(null);
  const handedOver = useRef(false); // onConfirm passed the session on: it is no longer ours to close

  const apply = (s: PhotoSession, r: { ok: boolean; geometry?: TableGeometry }, known?: Known) => {
    sid.current = s.id;
    setSession(s);
    setCrossed(false);
    if (r.ok && r.geometry) {
      const z = known ?? sizeOf(r.geometry);
      setCorners(cornersOf(r.geometry)); setSize(z); setOther(!isKnown(z));
      setGeometry(r.geometry); setFailed(false);
    } else {
      const z = known ?? DEFAULT;
      setCorners(defaultCorners(s)); setSize(z); setOther(!isKnown(z));
      setGeometry(null); setFailed(true);
    }
  };

  useEffect(() => {
    let live = true;
    detectPhoto(props.file).then(({ session: s, result, ms }) => {
      setTime('detect', ms);
      if (!live) { closeSession(s.id); return; }
      const kg = props.knownGrid;
      const known = props.knownSize ?? (kg && {
        width: kg.width, height: kg.height,
        ...(result.ok ? { colClueDepth: result.geometry.colClueDepth, rowClueDepth: result.geometry.rowClueDepth } : kg.fallbackDepth),
      });
      apply(s, result as never, known);
      if (result.ok && known) remesh(s.id, cornersOf(result.geometry), known);
    }).catch((e) => { if (live) setError(`Could not read the photo. (${why(e)})`); });
    return () => { // leaving the screen or a new file: free the worker's copy of the photo
      live = false;
      if (sid.current !== null && !handedOver.current) closeSession(sid.current);
      sid.current = null;
    };
  }, [props.file, attempt]);

  useEffect(() => { if (canvas.current && session) draw(canvas.current, session, geometry); }, [session, geometry]);

  const sizeOk = valid(size);

  // Returns the new geometry, or null when the quad is crossed / the worker rejects it / a newer call superseded this one.
  async function remesh(id: number, c: Point[], z: Known): Promise<TableGeometry | null> {
    const mine = ++seq.current;
    if (!convex(c)) { setCrossed(true); return null; }
    setBusy((n) => n + 1);
    try {
      const g = await meshFromCornersAsync(id, c, z);
      if (mine !== seq.current) return null;
      setGeometry(g); setCrossed(false); setFailed(false);
      return g;
    } catch {
      if (mine === seq.current) setCrossed(true);
      return null;
    } finally { setBusy((n) => n - 1); }
  }

  const change = (z: Known) => {
    setSize(z);
    if (session && valid(z)) remesh(session.id, corners, z);
  };

  const grab = (i: number, e: PointerEvent) => {
    const s = session!, r = box.current!.getBoundingClientRect(), c = corners[i];
    active.current = { id: e.pointerId, dx: r.left + (c.x / s.width) * r.width - e.clientX, dy: r.top + (c.y / s.height) * r.height - e.clientY, x0: e.clientX, y0: e.clientY, c0: c };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const drag = (i: number, e: PointerEvent, release: boolean) => {
    const s = session!, r = box.current!.getBoundingClientRect(), a = active.current!;
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
    const p = { x: clamp(((e.clientX + a.dx - r.left) / r.width) * s.width, s.width), y: clamp(((e.clientY + a.dy - r.top) / r.height) * s.height, s.height) };
    const next = corners.map((c, j) => (j === i ? p : c));
    setCorners(next);
    if (release && valid(size)) remesh(s.id, next, size);
    else setCrossed(!convex(next));
  };

  // A tap (moved < 4 px) or a cancelled gesture puts the corner back without a re-mesh.
  const end = (i: number, e: PointerEvent, cancel: boolean) => {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    if (!cancel && Math.hypot(e.clientX - a.x0, e.clientY - a.y0) >= 4) drag(i, e, true);
    else { const next = corners.map((c, j) => (j === i ? a.c0 : c)); setCorners(next); setCrossed(!convex(next)); }
    active.current = null;
  };

  const rotate = async () => {
    if (!session) return;
    seq.current++;
    setBusy((n) => n + 1);
    try { const r = await rotateSession(session.id, 1); apply(r.session, r.result as never); } catch (e) { setError(`Could not rotate the photo. (${why(e)})`); }
    finally { setBusy((n) => n - 1); }
  };

  const confirm = async () => {
    if (!session) return;
    const g = await remesh(session.id, corners, size);
    if (g) { handedOver.current = true; props.onConfirm({ sessionId: session.id, geometry: g }); }
  };

  const cancel = () => { if (sid.current !== null) closeSession(sid.current); sid.current = null; props.onCancel(); };

  const retry = () => { setError(''); setSession(null); setAttempt((n) => n + 1); };

  if (error) return (
    <main>
      <p class="error">{error}</p>
      <button type="button" class="primary" onClick={retry}>Try again</button>
      <button type="button" onClick={cancel}>Cancel</button>
    </main>
  );
  if (!session) return <main><p>Reading the photo…</p></main>;

  const num = (e: Event) => Number((e.target as HTMLInputElement).value);
  return (
    <main>
      {failed && <p class="error">Could not find the puzzle in this photo. Move the 4 corners onto the grid corners.</p>}
      {!failed && geometry && geometry.confidence < 0.6 && <p class="error">Check the size and clue depths — the photo was hard to read.</p>}
      {crossed && <p class="error">The corners are crossed.</p>}
      <div class="grid-check" ref={box}>
        <canvas ref={canvas} width={session.preview.width} height={session.preview.height} />
        {corners.map((c, i) => (
          <button key={i} type="button" class="handle" aria-label={NAMES[i]}
            style={`left: ${(c.x / session.width) * 100}%; top: ${(c.y / session.height) * 100}%`}
            onPointerDown={(e) => grab(i, e)}
            onPointerMove={(e) => { if (active.current?.id === e.pointerId) drag(i, e, false); }}
            onPointerUp={(e) => end(i, e, false)} onPointerCancel={(e) => end(i, e, true)} />
        ))}
      </div>
      <div class="field">
        <label for="gc-size">Size</label>
        <select id="gc-size" value={other ? 'other' : sizeKey(size.width, size.height)}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            if (v === 'other') { setOther(true); return; } // keep the current numbers in the fields
            const [w, h] = v.split('x').map(Number);
            setOther(false); change({ ...size, width: w, height: h });
          }}>
          {KNOWN_SIZES.map((k) => <option key={sizeKey(k.width, k.height)} value={sizeKey(k.width, k.height)}>{k.width} × {k.height}</option>)}
          <option value="other">Other…</option>
        </select>
      </div>
      {other && (
        <div class="field-row">
          <div class="field">
            <label for="gc-w">Width</label>
            <input id="gc-w" type="number" inputMode="numeric" min={MIN_SIDE} max={MAX_SIDE} value={size.width}
              onInput={(e) => change({ ...size, width: num(e) })} />
          </div>
          <div class="field">
            <label for="gc-h">Height</label>
            <input id="gc-h" type="number" inputMode="numeric" min={MIN_SIDE} max={MAX_SIDE} value={size.height}
              onInput={(e) => change({ ...size, height: num(e) })} />
          </div>
        </div>
      )}
      <div class="field-row">
        <div class="field">
          <label for="gc-rd">Row clue depth</label>
          <input id="gc-rd" type="number" inputMode="numeric" min={1} value={size.rowClueDepth}
            onInput={(e) => change({ ...size, rowClueDepth: Number((e.target as HTMLInputElement).value) })} />
        </div>
        <div class="field">
          <label for="gc-cd">Column clue depth</label>
          <input id="gc-cd" type="number" inputMode="numeric" min={1} value={size.colClueDepth}
            onInput={(e) => change({ ...size, colClueDepth: Number((e.target as HTMLInputElement).value) })} />
        </div>
      </div>
      <button type="button" onClick={rotate}>Rotate</button>
      <button type="button" onClick={cancel}>Cancel</button>
      <button type="button" class="primary" disabled={busy > 0 || crossed || !sizeOk} onClick={confirm}>Use this grid</button>
    </main>
  );
}
