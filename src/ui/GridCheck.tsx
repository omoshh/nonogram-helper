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
  const seg = (a: Point, b: Point, grid: boolean) => {
    ctx.strokeStyle = grid ? '#e11' : 'rgba(238,17,17,0.4)';
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
  onConfirm: (r: { sessionId: number; geometry: TableGeometry }) => void;
  onCancel: () => void;
}) {
  const [session, setSession] = useState<PhotoSession | null>(null);
  const [corners, setCorners] = useState<Point[]>([]);
  const [size, setSize] = useState<Known>(DEFAULT);
  const [geometry, setGeometry] = useState<TableGeometry | null>(null);
  const [failed, setFailed] = useState(false);
  const [crossed, setCrossed] = useState(false);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0); // only the latest re-mesh may update the screen
  const sid = useRef<number | null>(null);
  const active = useRef<number | null>(null); // pointer id of the handle being dragged

  const apply = (s: PhotoSession, r: { ok: boolean; geometry?: TableGeometry }, known?: Known) => {
    sid.current = s.id;
    setSession(s);
    setCrossed(false);
    if (r.ok && r.geometry) {
      setCorners(cornersOf(r.geometry)); setSize(known ?? sizeOf(r.geometry));
      setGeometry(r.geometry); setFailed(false);
    } else {
      setCorners(defaultCorners(s)); setSize(known ?? DEFAULT);
      setGeometry(null); setFailed(true);
    }
  };

  useEffect(() => {
    let live = true;
    detectPhoto(props.file).then(({ session: s, result, ms }) => {
      setTime('detect', ms);
      if (!live) { closeSession(s.id); return; }
      apply(s, result as never, props.knownSize);
      if (result.ok && props.knownSize) remesh(s.id, cornersOf(result.geometry), props.knownSize);
    }).catch(() => { if (live) setError('Could not read the photo.'); });
    return () => { live = false; };
  }, [props.file]);

  useEffect(() => { if (canvas.current && session) draw(canvas.current, session, geometry); }, [session, geometry]);

  const depthOk = (n: number) => Number.isInteger(n) && n >= 1;
  const sizeOk = depthOk(size.colClueDepth) && depthOk(size.rowClueDepth);

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
    if (session && depthOk(z.colClueDepth) && depthOk(z.rowClueDepth)) remesh(session.id, corners, z);
  };

  const drag = (i: number, e: PointerEvent, release: boolean) => {
    const s = session!, r = box.current!.getBoundingClientRect();
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
    const p = { x: clamp(((e.clientX - r.left) / r.width) * s.width, s.width), y: clamp(((e.clientY - r.top) / r.height) * s.height, s.height) };
    const next = corners.map((c, j) => (j === i ? p : c));
    setCorners(next);
    if (release) remesh(s.id, next, size);
    else setCrossed(!convex(next));
  };

  const rotate = async () => {
    if (!session) return;
    seq.current++;
    setBusy((n) => n + 1);
    try { const r = await rotateSession(session.id, 1); apply(r.session, r.result as never); } catch { setError('Could not rotate the photo.'); }
    finally { setBusy((n) => n - 1); }
  };

  const confirm = async () => {
    if (!session) return;
    const g = await remesh(session.id, corners, size);
    if (g) props.onConfirm({ sessionId: session.id, geometry: g });
  };

  const cancel = () => { if (sid.current !== null) closeSession(sid.current); props.onCancel(); };

  if (error) return <main><p class="error">{error}</p><button type="button" onClick={cancel}>Cancel</button></main>;
  if (!session) return <main><p>Reading the photo…</p></main>;

  const known = KNOWN_SIZES.some((k) => k.width === size.width && k.height === size.height);
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
            onPointerDown={(e) => { active.current = e.pointerId; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); }}
            onPointerMove={(e) => { if (active.current === e.pointerId) drag(i, e, false); }}
            onPointerUp={(e) => { if (active.current === e.pointerId) { active.current = null; drag(i, e, true); } }} />
        ))}
      </div>
      <div class="field">
        <label for="gc-size">Size</label>
        <select id="gc-size" value={sizeKey(size.width, size.height)}
          onChange={(e) => { const [w, h] = (e.target as HTMLSelectElement).value.split('x').map(Number); change({ ...size, width: w, height: h }); }}>
          {!known && <option value={sizeKey(size.width, size.height)}>{size.width} × {size.height}</option>}
          {KNOWN_SIZES.map((k) => <option key={sizeKey(k.width, k.height)} value={sizeKey(k.width, k.height)}>{k.width} × {k.height}</option>)}
        </select>
      </div>
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
