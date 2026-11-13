export const INPUT_HISTORY_MAX = 50;

// Newest first, no repeats of the line just sent.
export function pushInputHistory(history: string[], text: string): string[] {
  return history[0] === text ? history : [text, ...history].slice(0, INPUT_HISTORY_MAX);
}

// Position after Up (older, +1) or Down (newer, -1); -1 means the draft being typed.
export function stepInputHistory(index: number, delta: 1 | -1, length: number): number {
  return Math.max(-1, Math.min(length - 1, index + delta));
}
