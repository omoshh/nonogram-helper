/** Parses typed clue text. Separators: runs of spaces, '.', ',', '-'. Null = invalid. */
export function parseClueLine(text: string): number[] | null {
  const parts = text.split(/[\s.,-]+/).filter(Boolean);
  const clues: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    clues.push(Number(part));
  }
  if (clues.length === 1 && clues[0] === 0) return [];
  return clues.some((n) => n <= 0) ? null : clues;
}

export function formatClueLine(clues: number[]): string {
  return clues.join(' ');
}

export const KNOWN_SIZES: ReadonlyArray<{ width: number; height: number }> = [
  { width: 20, height: 15 },
  { width: 15, height: 20 },
  { width: 20, height: 20 },
  { width: 20, height: 35 },
  { width: 25, height: 30 },
  { width: 25, height: 35 },
  { width: 25, height: 40 },
  { width: 35, height: 25 },
  { width: 50, height: 35 },
  { width: 35, height: 50 }, // second journal
];
