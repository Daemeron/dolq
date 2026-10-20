import type { Message } from '../types';

const SAME_MESSAGE_WINDOW_MS = 5000;

// History fetched on first view already contains messages that arrived live
// before the channel was opened; drop those so they aren't shown twice.
export function mergeHistory(history: Message[], live: Message[]): Message[] {
  const duplicate = (h: Message) =>
    live.some(
      (m) =>
        m.nick === h.nick &&
        m.text === h.text &&
        !!m.action === !!h.action &&
        !!m.notice === !!h.notice &&
        !!m.system === !!h.system &&
        Math.abs(m.timestamp.getTime() - h.timestamp.getTime()) <= SAME_MESSAGE_WINDOW_MS,
    );
  return [...history.filter((h) => !duplicate(h)), ...live];
}
