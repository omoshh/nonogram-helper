import type { GrayImage, Point } from '../vision/types';
import type { LineRef } from '../core/types';
import { toGray, downscale, rotate90 } from '../vision/image';
import { detect, meshFromCorners, type TableGeometry, type TableSize } from '../vision/mesh';
import { cutStrip, cellPatches, cellView } from '../vision/strips';
import { readMarks, MARK_PX } from '../vision/marks';

export interface PhotoSession { id: number; width: number; height: number; preview: ImageBitmap }
export type DetectResult = ReturnType<typeof detect>;

export type VisionRequest =
  | { id: number; kind: 'detect'; file: Blob }
  | { id: number; kind: 'mesh'; sessionId: number; corners: Point[]; size: TableSize }
  | { id: number; kind: 'rotate'; sessionId: number }
  | { id: number; kind: 'strips'; sessionId: number; g: TableGeometry; px: number }
  | { id: number; kind: 'marks'; sessionId: number; g: TableGeometry; givens: number[] }
  | { id: number; kind: 'close'; sessionId: number };

export type VisionResponse =
  | { id: number; ok: true; kind: 'detect'; session: PhotoSession; result: DetectResult; ms: number }
  | { id: number; ok: true; kind: 'mesh'; geometry: TableGeometry }
  | { id: number; ok: true; kind: 'rotate'; session: PhotoSession; result: DetectResult }
  | { id: number; ok: true; kind: 'strips'; rows: Blob[]; cols: Blob[] }
  | { id: number; ok: true; kind: 'marks'; cells: Uint8Array; unsure: number[]; views: Blob[]; ms: number }
  | { id: number; ok: true; kind: 'close' }
  | { id: number; ok: false; error: string };

type Turns = 0 | 1 | 2 | 3;
// One session at a time: as-taken gray photo, total quarter turns CW, cached upright image.
let cur: { id: number; photo: GrayImage; k: Turns; upright: GrayImage } | null = null;
let nextSession = 1;

function session(id: number) {
  if (!cur || cur.id !== id) throw new Error('Photo session is closed');
  return cur;
}

function canvasOf(img: GrayImage): OffscreenCanvas {
  const rgba = new Uint8ClampedArray(img.width * img.height * 4);
  for (let i = 0; i < img.data.length; i++) rgba.fill(img.data[i], 4 * i, 4 * i + 3), (rgba[4 * i + 3] = 255);
  const c = new OffscreenCanvas(img.width, img.height);
  c.getContext('2d')!.putImageData(new ImageData(rgba, img.width, img.height), 0, 0);
  return c;
}

const png = (img: GrayImage) => canvasOf(img).convertToBlob({ type: 'image/png' });

function sessionInfo(s: NonNullable<typeof cur>): PhotoSession {
  const f = Math.max(1, Math.ceil(Math.max(s.upright.width, s.upright.height) / 1600));
  const preview = canvasOf(f === 1 ? s.upright : downscale(s.upright, f)).transferToImageBitmap();
  return { id: s.id, width: s.upright.width, height: s.upright.height, preview };
}

async function handle(req: VisionRequest): Promise<{ msg: VisionResponse; transfer?: Transferable[] }> {
  const id = req.id;
  switch (req.kind) {
    case 'detect': {
      cur = null;
      const bmp = await createImageBitmap(req.file, { imageOrientation: 'from-image' });
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      const d = ctx.getImageData(0, 0, c.width, c.height);
      const photo = toGray(d.data, d.width, d.height);
      const result = detect(photo);
      const k = (result.ok ? result.geometry.rotation : (result.rotation ?? 0)) as Turns;
      cur = { id: nextSession++, photo, k, upright: rotate90(photo, k) };
      const info = sessionInfo(cur);
      return { msg: { id, ok: true, kind: 'detect', session: info, result, ms: result.ok ? result.ms : 0 }, transfer: [info.preview] };
    }
    case 'mesh': {
      const s = session(req.sessionId);
      // meshFromCorners throws on degenerate corners; the caller sees a plain rejection.
      return { msg: { id, ok: true, kind: 'mesh', geometry: { ...meshFromCorners(s.upright, req.corners, req.size), rotation: s.k } } };
    }
    case 'rotate': {
      const s = session(req.sessionId);
      s.k = ((s.k + 1) % 4) as Turns;
      s.upright = rotate90(s.photo, s.k);
      const det = detect(s.upright);
      // The user's rotation wins: accept the detector only if it agrees the image is upright.
      const result: DetectResult = det.ok && det.geometry.rotation === 0
        ? { ...det, geometry: { ...det.geometry, rotation: s.k } }
        : { ok: false, reason: 'manual-rotation', rotation: s.k };
      const info = sessionInfo(s);
      return { msg: { id, ok: true, kind: 'rotate', session: info, result }, transfer: [info.preview] };
    }
    case 'strips': {
      const s = session(req.sessionId);
      const cut = (axis: 'row' | 'col', n: number) =>
        Promise.all(Array.from({ length: n }, (_, index) => png(cutStrip(s.upright, req.g, { axis, index } as LineRef, req.px))));
      const [rows, cols] = await Promise.all([cut('row', req.g.height), cut('col', req.g.width)]);
      return { msg: { id, ok: true, kind: 'strips', rows, cols } };
    }
    case 'marks': {
      const s = session(req.sessionId);
      const t0 = performance.now();
      const { cells, unsure } = readMarks(cellPatches(s.upright, req.g, MARK_PX), new Set(req.givens), req.g.width);
      const views = await Promise.all(unsure.map((cell) => png(cellView(s.upright, req.g, cell, 48))));
      return { msg: { id, ok: true, kind: 'marks', cells, unsure, views, ms: performance.now() - t0 } };
    }
    case 'close':
      if (cur?.id === req.sessionId) cur = null;
      return { msg: { id, ok: true, kind: 'close' } };
  }
}

self.onmessage = async (e: MessageEvent<VisionRequest>) => {
  try {
    const { msg, transfer } = await handle(e.data);
    (self as unknown as Worker).postMessage(msg, transfer ?? []);
  } catch (err) {
    const m: VisionResponse = { id: e.data.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    (self as unknown as Worker).postMessage(m);
  }
};
