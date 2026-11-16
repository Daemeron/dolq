import { describe, expect, it } from 'vitest';
import { formatDuration } from './duration';

describe('formatDuration', () => {
  it.each([
    [-5, '0 s'],
    [0, '0 s'],
    [40_000, '40 s'],
    [59_999, '59 s'],
    [60_000, '1 min'],
    [5 * 60_000 + 30_000, '5 min'],
    [(2 * 60 + 14) * 60_000, '2 h 14 min'],
    [(23 * 60 + 59) * 60_000, '23 h 59 min'],
    [(3 * 24 + 4) * 3_600_000, '3 d 4 h'],
  ])('writes %d ms as %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});
