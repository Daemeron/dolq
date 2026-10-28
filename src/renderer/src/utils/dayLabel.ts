import type { Message } from '../types';

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

// Today, Yesterday, or the date spelled out (with the year when it is not this one).
export function dayName(date: Date, now = new Date()): string {
  if (sameDay(date, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Yesterday';
  const year = date.getFullYear() === now.getFullYear() ? undefined : 'numeric';
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year });
}

// The label above the first message of a day, or null when the message continues the previous message's day.
export function dayLabel(prev: Message | undefined, m: Message, now = new Date()): string | null {
  if (prev && sameDay(prev.timestamp, m.timestamp)) return null;
  return dayName(m.timestamp, now);
}
