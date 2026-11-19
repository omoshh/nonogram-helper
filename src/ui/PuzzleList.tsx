import { useEffect, useState } from 'preact/hooks';
import { listPuzzles, exportAll, importAll, type PuzzleRecord } from '../store/db';

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function PuzzleList() {
  const [puzzles, setPuzzles] = useState<PuzzleRecord[] | null>(null);
  const [message, setMessage] = useState('');

  const load = () => listPuzzles().then(setPuzzles, (e) => setMessage(`Could not load puzzles: ${e.message}`));
  useEffect(() => { load(); }, []);

  const exportBackup = async () => {
    try {
      const blob = new Blob([await exportAll()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nonogram-backup-${today()}.json`;
      // Firefox for Android only downloads from an anchor that is in the document.
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setMessage(`Could not export: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const importBackup = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const n = await importAll(await file.text());
      setMessage(`${n} ${n === 1 ? 'puzzle' : 'puzzles'} imported`);
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main>
      <a class="button primary" href="#/new">New puzzle</a>
      {message && <p class="message" role="status">{message}</p>}
      {puzzles === null ? (
        <p class="hint">Loading…</p>
      ) : puzzles.length === 0 ? (
        <p class="hint">No puzzles yet.</p>
      ) : (
        <ul class="cards">
          {puzzles.map((p) => (
            <li key={p.id}>
              <a class="card" href={`#/p/${p.id}`}>
                <strong>{p.width} × {p.height}</strong>
                {(p.journal || p.page) && (
                  <span>{[p.journal, p.page && `page ${p.page}`].filter(Boolean).join(', ')}</span>
                )}
                <span class="hint">{p.solvedDate ? `Solved ${p.solvedDate}` : 'Not solved'}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <div class="backup">
        <button type="button" class="secondary" onClick={exportBackup}>Export backup</button>
        <label class="button secondary">
          Import backup
          <input type="file" accept="application/json,.json" hidden onChange={importBackup} />
        </label>
      </div>
    </main>
  );
}
