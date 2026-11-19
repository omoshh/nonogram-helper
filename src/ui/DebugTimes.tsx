import { useEffect, useState } from 'preact/hooks';

const times = new Map<string, number>();
const listeners = new Set<() => void>();

/** Records the last duration for a label (e.g. 'solve', 'hint'). */
export function setTime(label: string, ms: number): void {
  times.set(label, ms);
  for (const l of listeners) l();
}

export function DebugTimes() {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  const entries = [...times];
  return (
    <footer class="debug-times">
      {entries.length === 0
        ? 'No times yet'
        : entries.map(([label, ms]) => <span key={label}>{label}: {Math.round(ms)} ms</span>)}
    </footer>
  );
}
