import type { LineRef } from '../core/types';
import type { GrayImage } from './types';
import type { TableGeometry } from './mesh';
import { clueCells, cornerBox } from './strips';
import { glyphs, glyphVector, inkGroups, nearest, type Sample } from './digits';

export interface CellRead { value: number | null /* null = empty */; sure: boolean }
export interface ClueRead { rows: CellRead[][]; cols: CellRead[][]; rowClues: number[][]; colClues: number[][]; unsure: LineRef[] }

// Margins: the 12 clean-clue training photos, leave one puzzle out, clean sources (2026-11-22).
const CLUE_PX = 32; // clue cell render size; 24 adds 15 wrong cells, 40 same
const LABEL_PX = 48; // corner box px per cell; label digits are 25-37 px tall at this size, all 31 labels read
const MAX_DIST = 3.4; // correct glyphs reach 3.01 (3.49 with the shipped thinned set); 3.0 flags 1 more line
const MAX_RATIO = 0.9; // best / best-of-another-digit; the one clean misread is at 0.92, correct reads reach 0.97 (flagged); 0.85 flags 3+ more lines

/** Value of a cell from its glyph classes; a leading zero, a 0 or a non-digit glyph is unsure. */
export function cellValue(digits: string[]): CellRead {
  if (!digits.length) return { value: null, sure: true };
  const s = digits.join('');
  return /^[1-9]\d?$/.test(s) ? { value: Number(s), sure: true } : { value: /^\d+$/.test(s) ? Number(s) : null, sure: false };
}

/** Clues of one line from its cells (farthest from the grid first); a gap in the run, a 0 or a too-long value is unsure. */
export function lineFromCells(cells: CellRead[], length: number): { clues: number[]; sure: boolean } {
  const first = cells.findIndex((c) => c.value !== null);
  const run = first < 0 ? [] : cells.slice(first);
  const clues = run.flatMap((c) => (c.value === null ? [] : [c.value]));
  const sure = cells.every((c) => c.sure) && clues.length === run.length && clues.every((v) => v >= 1 && v <= length);
  return { clues, sure };
}

function readGlyphs(gs: GrayImage[], samples: Sample[]): { digits: string[]; sure: boolean } {
  let sure = true;
  const digits = gs.map((im) => {
    const n = nearest(glyphVector(im), samples);
    if (n.dist > MAX_DIST || n.dist > MAX_RATIO * n.other) sure = false;
    return n.d;
  });
  return { digits, sure };
}

function readCell(cell: GrayImage, samples: Sample[]): CellRead {
  const gs = glyphs(cell);
  if (!gs) return { value: null, sure: false };
  const r = readGlyphs(gs, samples), c = cellValue(r.digits);
  return { value: c.value, sure: c.sure && r.sure };
}

export function readClues(upright: GrayImage, g: TableGeometry, samples: Sample[]): ClueRead {
  const cells = clueCells(upright, g, CLUE_PX);
  const rows = cells.rows.map((l) => l.map((c) => readCell(c, samples)));
  const cols = cells.cols.map((l) => l.map((c) => readCell(c, samples)));
  const unsure: LineRef[] = [];
  const lines = (ls: CellRead[][], axis: LineRef['axis'], length: number) => ls.map((l, index) => {
    const r = lineFromCells(l, length);
    if (!r.sure) unsure.push({ axis, index });
    return r.clues;
  });
  const rowClues = lines(rows, 'row', g.width), colClues = lines(cols, 'col', g.height);
  return { rows, cols, rowClues, colClues, unsure };
}

// The label glyphs: ink groups on the text line of the tallest group in the corner box, left to right.
function labelGlyphs(upright: GrayImage, g: TableGeometry): GrayImage[] {
  // a group taller than a cell is not text (a thumb over the corner on one photo)
  const gs = inkGroups(cornerBox(upright, g, LABEL_PX), LABEL_PX).filter((x) => x.im.height < LABEL_PX);
  if (!gs.length) return [];
  const top = gs.reduce((a, b) => (b.im.height > a.im.height ? b : a)), mid = top.y + top.im.height / 2;
  return gs.filter((x) => x.y <= mid && x.y + x.im.height >= mid).map((x) => x.im);
}

/** Size printed in the corner box (`W x H`), or null unless every glyph is sure and both sides are 1-50. */
export function readLabel(upright: GrayImage, g: TableGeometry, samples: Sample[]): { width: number; height: number } | null {
  const r = readGlyphs(labelGlyphs(upright, g), samples);
  const m = /^([1-9]\d?)x([1-9]\d?)$/.exec(r.digits.join(''));
  if (!r.sure || !m) return null;
  const width = Number(m[1]), height = Number(m[2]);
  return width <= 50 && height <= 50 ? { width, height } : null;
}

/** Training samples: glyphs of every labeled non-empty clue cell (clues right/bottom aligned) and of the size label. */
export function collectSamples(upright: GrayImage, g: TableGeometry, rows: number[][], cols: number[][], label: string): Sample[] {
  const out: Sample[] = [];
  const add = (gs: GrayImage[] | null, text: string) => {
    if (gs && gs.length === text.length) gs.forEach((im, i) => out.push({ d: text[i], v: glyphVector(im) }));
  };
  const cells = clueCells(upright, g, CLUE_PX);
  const lines = (ls: GrayImage[][], clues: number[][]) => ls.forEach((l, i) => {
    const c = clues[i].slice(-l.length); // a photo may cut off clues beyond the visible depth
    c.forEach((v, k) => add(glyphs(l[l.length - c.length + k]), String(v)));
  });
  lines(cells.rows, rows);
  lines(cells.cols, cols);
  add(labelGlyphs(upright, g), label);
  return out;
}
