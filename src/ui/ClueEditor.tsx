import { useEffect, useState } from 'preact/hooks';
import { FILLED, UNKNOWN, type LineRef } from '../core/types';
import { formatClueLine, parseClueLine } from '../core/clues';
import { lineNameCap as lineName } from '../core/text';
import { GridView } from './GridView';

const fieldId = (l: LineRef) => `clue-${l.axis}-${l.index}`;

/** Raw text of every clue field plus the givens. */
export type Draft = { rows: string[]; cols: string[]; givens: number[] };

type Clues = { rows: number[][]; cols: number[][]; givens: number[] };

/** Text fields keep what was typed; the parent re-mounts (key) to load new clues. */
export function ClueEditor(props: {
  width: number; height: number; rows: number[][]; cols: number[][]; givens: number[];
  flagged: LineRef[];
  /** Lines the photo reader was unsure about; each gets an OK button. */
  unsure?: LineRef[];
  /** The user edited that line's field or tapped its OK button. */
  onChecked?: (l: LineRef) => void;
  onChange: (next: Clues) => void;
  /** Number of fields whose text is not a valid clue line. */
  onInvalidChange?: (count: number) => void;
  initialText?: Draft;
  onDraft?: (d: Draft) => void;
  /** Object URLs of the clue images cut from a photo, shown above each field. */
  strips?: { rows: string[]; cols: string[] };
}) {
  const { width, height, rows, cols, givens, flagged, onChange, onInvalidChange, onDraft } = props;
  const [rowText, setRowText] = useState(() => props.initialText?.rows ?? rows.map(formatClueLine));
  const [colText, setColText] = useState(() => props.initialText?.cols ?? cols.map(formatClueLine));
  const [showGivens, setShowGivens] = useState(false);

  const invalid = [...rowText, ...colText].filter((t) => parseClueLine(t) === null).length;
  useEffect(() => { onInvalidChange?.(invalid); }, [invalid]);

  useEffect(() => { onDraft?.({ rows: rowText, cols: colText, givens }); }, [rowText, colText, givens]);

  const isFlagged = (l: LineRef) => flagged.some((f) => f.axis === l.axis && f.index === l.index);

  const isUnsure = (l: LineRef) => !!props.unsure?.some((f) => f.axis === l.axis && f.index === l.index);

  const edit = (l: LineRef, text: string) => {
    props.onChecked?.(l);
    const texts = l.axis === 'row' ? rowText : colText;
    const nextTexts = texts.map((t, i) => (i === l.index ? text : t));
    (l.axis === 'row' ? setRowText : setColText)(nextTexts);
    const parsed = parseClueLine(text);
    if (parsed === null) return;
    const list = (l.axis === 'row' ? rows : cols).map((c, i) => (i === l.index ? parsed : c));
    onChange(l.axis === 'row' ? { rows: list, cols, givens } : { rows, cols: list, givens });
  };

  const toggleGiven = (cell: number) => {
    const next = givens.includes(cell) ? givens.filter((g) => g !== cell) : [...givens, cell].sort((a, b) => a - b);
    onChange({ rows, cols, givens: next });
  };

  const jump = (l: LineRef) => {
    const el = document.getElementById(fieldId(l));
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    el?.focus({ preventScroll: true });
  };

  const field = (l: LineRef, text: string) => {
    const bad = parseClueLine(text) === null;
    return (
      <div key={fieldId(l)} class={`clue-line${isFlagged(l) ? ' flagged' : ''}${isUnsure(l) ? ' unsure' : ''}`}>
        <label for={fieldId(l)}>{lineName(l)}</label>
        {props.strips?.[l.axis === 'row' ? 'rows' : 'cols'][l.index] && (
          <img src={props.strips[l.axis === 'row' ? 'rows' : 'cols'][l.index]} alt="" style="max-width:100%" />
        )}
        <input
          id={fieldId(l)}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          aria-invalid={bad ? 'true' : 'false'}
          class={bad ? 'invalid' : undefined}
          onInput={(e) => edit(l, (e.target as HTMLInputElement).value)}
        />
        {isUnsure(l) && (
          <button type="button" class="secondary" aria-label={`${lineName(l)} is right`} onClick={() => props.onChecked?.(l)}>OK</button>
        )}
      </div>
    );
  };

  const cells = new Uint8Array(width * height).fill(UNKNOWN);
  for (const g of givens) cells[g] = FILLED;

  return (
    <div class="clue-editor">
      {flagged.length > 0 && (
        <section class="check-lines">
          <h3>Check these lines</h3>
          <div class="chips">
            {flagged.map((l) => (
              <button type="button" key={fieldId(l)} onClick={() => jump(l)}>{lineName(l)}</button>
            ))}
          </div>
        </section>
      )}

      <section>
        <button type="button" class="secondary" aria-pressed={showGivens} onClick={() => setShowGivens(!showGivens)}>
          Givens ({givens.length})
        </button>
        {showGivens && (
          <>
            <p class="hint">Tap a cell to mark it as printed filled.</p>
            <GridView width={width} height={height} cells={cells} onTap={toggleGiven} />
          </>
        )}
      </section>

      <section>
        <h3>Rows <small>(top to bottom)</small></h3>
        {rowText.map((t, i) => field({ axis: 'row', index: i }, t))}
      </section>
      <section>
        <h3>Columns <small>(left to right)</small></h3>
        {colText.map((t, i) => field({ axis: 'col', index: i }, t))}
      </section>
    </div>
  );
}
