export function insertAtCaret(
  value: string,
  start: number,
  end: number,
  insertion: string,
): { text: string; caret: number } {
  return { text: value.slice(0, start) + insertion + value.slice(end), caret: start + insertion.length };
}
