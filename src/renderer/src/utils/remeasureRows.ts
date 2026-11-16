/** Measures every drawn row again, for when what they were measured against has changed (fonts arriving, the window being shown). */
export function remeasureRows(container: ParentNode | null, measure: (row: Element) => void) {
  for (const row of container?.querySelectorAll('[data-index]') ?? []) measure(row);
}
