import type { Puzzle } from '../core/types';
import { putPuzzle, type PuzzleRecord } from '../store/db';
import { SolveFlow } from './SolveFlow';
import { RecordGate, toPuzzle, usePuzzleRecord } from './PuzzlePage';

/** Clue editor for a saved puzzle; the record changes only after a successful solve or "Save anyway". */
export function EditClues(props: { id: string }) {
  const rec = usePuzzleRecord(props.id);
  const save = (old: PuzzleRecord) =>
    async (solved: Puzzle, status: 'unique' | 'multiple', reference: Uint8Array) => {
      // lastMarks is left out: marks made against the old clues no longer apply.
      const { lastMarks: _, ...keep } = old;
      await putPuzzle({ ...keep, ...solved, reference, status });
      return `#/p/${old.id}`;
    };
  return (
    <RecordGate rec={rec}>
      {(r) => (
        <main>
          <a href={`#/p/${r.id}`}>← Back to the puzzle</a>
          <h2>Edit clues {r.width} × {r.height}</h2>
          <SolveFlow key={r.id} initial={toPuzzle(r)} save={save(r)} />
        </main>
      )}
    </RecordGate>
  );
}
