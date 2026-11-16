import { describe, expect, it } from 'vitest';
import { formatBytes } from './bytes';

describe('formatBytes in units of 1000', () => {
  it.each([
    [0, '0 B'],
    [999, '999 B'],
    [1000, '1.0 KB'],
    [1_500_000, '1.5 MB'],
    [3_700_000_000_000, '3.7 TB'],
    [6_500_000_000_000, '6.5 TB'],
    [2_000_000_000_000_000, '2000.0 TB'],
  ])('writes %d bytes as %s, the way the backend log does', (n, text) => {
    expect(formatBytes(n, 1000)).toBe(text);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
  ])('writes %d bytes as %s by default', (n, text) => {
    expect(formatBytes(n)).toBe(text);
  });
});
