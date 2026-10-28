import type { Message } from '../types';

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

// The label above the first message of a day, or null when the message continues the previous message's day.
export function dayLabel(prev: Message | undefined, m: Message, now = new Date()): string | null {
  if (prev && sameDay(prev.timestamp, m.timestamp)) return null;
  if (sameDay(m.timestamp, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(m.timestamp, yesterday)) return 'Yesterday';
  const year = m.timestamp.getFullYear() === now.getFullYear() ? undefined : 'numeric';
  return m.timestamp.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year });
}
