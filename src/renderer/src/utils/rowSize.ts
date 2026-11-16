/** The height of a folded run's summary line: its padding and one line of text. A test measures it in a real browser. */
export const SUMMARY_HEIGHT = 28;

/** The height of a log line, which is one line of text. A test measures it in a real browser. */
export const LOG_LINE_HEIGHT = 20;

export type RowSizeInput = {
  isLog: boolean;
  compact: boolean;
  /** Part of a folded run, but not its head, while the run is closed: drawn as nothing. */
  hidden: boolean;
  /** The head of a run of joins and parts: the summary line, and with the run open the head's own line under it. */
  run: 'closed' | 'open' | null;
};

/** What the message list assumes a row measures until it is drawn and measured. Rows differ in size, so this is a guess. */
export function estimateRowSize({ isLog, compact, hidden, run }: RowSizeInput): number {
  if (hidden) return 0;
  if (run === 'closed') return SUMMARY_HEIGHT;
  const line = isLog ? LOG_LINE_HEIGHT : compact ? 24 : 30;
  return run === 'open' ? SUMMARY_HEIGHT + line : line;
}
