import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { dayLabel } from './dayLabel';

const now = new Date(2026, 9, 28, 12, 0);
const at = (y: number, mo: number, d: number, h = 9): Message => ({
  id: 1,
  nick: 'a',
  text: 'x',
  timestamp: new Date(y, mo, d, h),
});

describe('dayLabel', () => {
  it('labels the first message of the current day Today', () => {
    expect(dayLabel(undefined, at(2026, 9, 28), now)).toBe('Today');
  });

  it('labels the previous day Yesterday', () => {
    expect(dayLabel(at(2026, 9, 26), at(2026, 9, 27), now)).toBe('Yesterday');
  });

  it('gives no label to a message on the same day as the one before', () => {
    expect(dayLabel(at(2026, 9, 28, 8), at(2026, 9, 28, 20), now)).toBeNull();
  });

  it('spells out an older date, with the year only when it is not this one', () => {
    expect(dayLabel(undefined, at(2026, 9, 20), now)).toMatch(/October/);
    expect(dayLabel(undefined, at(2026, 9, 20), now)).not.toMatch(/2026/);
    expect(dayLabel(undefined, at(2025, 2, 3), now)).toMatch(/2025/);
  });
});
