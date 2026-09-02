// Splices `insertion` into `value` between start/end (an input's current
// selection - a collapsed caret has start === end), replacing any selected
// text the same way typing over a selection would. Returns the caret
// position insertion should land the cursor at afterward - the length of
// insertion delivered separately, not baked into `text`, since MessageInput
// needs both to update the input's value and its selection range.
export function insertAtCaret(
  value: string, start: number, end: number, insertion: string,
): { text: string; caret: number } {
  return { text: value.slice(0, start) + insertion + value.slice(end), caret: start + insertion.length };
}
