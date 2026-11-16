import { describe, expect, it } from 'vitest';
import { coverageBadge } from './coverageBadge';

describe('coverageBadge', () => {
  it('is a shields endpoint file with the percentage to one decimal', () => {
    expect(coverageBadge('frontend coverage', 96.43)).toEqual({
      schemaVersion: 1,
      label: 'frontend coverage',
      message: '96.4%',
      color: 'brightgreen',
    });
  });
  it.each([
    [100, 'brightgreen'],
    [90, 'brightgreen'],
    [89.9, 'green'],
    [80, 'green'],
    [79.9, 'yellowgreen'],
    [70, 'yellowgreen'],
    [60, 'yellow'],
    [50, 'orange'],
    [49.9, 'red'],
    [0, 'red'],
  ])('colours %s%% as %s', (percent, color) => {
    expect(coverageBadge('x', percent).color).toBe(color);
  });
});
