import { describe, expect, it } from 'vitest';
import { formatBytes, formatRate } from './bytes';
import { latencyRange, latencyStats, latencyTone } from './latency';
import { sparklinePoints } from './sparkline';
import { transferRates } from './transferRate';

describe('formatBytes and formatRate', () => {
  it('scales to the largest fitting unit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 GB');
    expect(formatBytes(2 * 1024 ** 5)).toBe('2048.0 TB');
    expect(formatRate(2 * 1024 * 1024)).toBe('2.0 MB/s');
  });
});

describe('latencyStats and latencyTone', () => {
  it('summarises the samples, and has nothing to say about none', () => {
    expect(latencyStats([])).toBeNull();
    expect(latencyStats([{ ms: 40 }, { ms: 100 }, { ms: 10 }])).toEqual({ last: 10, min: 10, max: 100, avg: 50 });
  });

  it('never scales a trend tighter than 50 ms, so a steady line looks steady', () => {
    expect(latencyRange({ last: 11, min: 11, max: 12, avg: 11 })).toEqual({ min: 11, max: 61 });
    expect(latencyRange({ last: 85, min: 28, max: 185, avg: 85 })).toEqual({ min: 28, max: 185 });
  });

  it('grades a round trip', () => {
    expect(latencyTone(149)).toBe('ok');
    expect(latencyTone(150)).toBe('warn');
    expect(latencyTone(400)).toBe('danger');
  });
});

describe('sparklinePoints', () => {
  it('scales a series into the box, highest value at the top', () => {
    expect(sparklinePoints([0, 10, 5], 100, 20)).toBe('0.0,20.0 50.0,0.0 100.0,10.0');
  });

  it('puts several series on one shared scale when given a range', () => {
    const range = { min: 0, max: 10 };
    expect(sparklinePoints([0, 5], 10, 20, range)).toBe('0.0,20.0 10.0,10.0');
    expect(sparklinePoints([10, 10], 10, 20, range)).toBe('0.0,0.0 10.0,0.0');
    expect(sparklinePoints([3, 3], 10, 20, { min: 0, max: 0 })).toBe('0.0,10.0 10.0,10.0');
  });

  it('puts a flat or single point series mid-height, and an empty one nowhere', () => {
    expect(sparklinePoints([7, 7], 10, 20)).toBe('0.0,10.0 10.0,10.0');
    expect(sparklinePoints([7], 10, 20)).toBe('0.0,10.0');
    expect(sparklinePoints([], 10, 20)).toBe('');
  });
});

describe('transferRates', () => {
  it('adds up what is running, split by direction, and ignores what is over or paused', () => {
    const rates = transferRates([
      { speedBps: 100 },
      { speedBps: 50, sending: true },
      { speedBps: 25 },
      { speedBps: 999, done: true },
      { speedBps: 999, error: 'x' },
      { speedBps: 999, paused: true },
      {},
    ]);
    expect(rates).toEqual({ down: 125, up: 50, active: 5 });
  });
});
