import { describe, expect, it } from 'vitest';
import { updateSpeed } from './transferSpeed';

describe('updateSpeed', () => {
  it('starts a baseline at the first event, with no speed yet', () => {
    expect(updateSpeed(undefined, 100, 5000)).toEqual({ track: { received: 100, at: 5000 } });
  });

  it('says nothing, and keeps the baseline, until a full window has passed', () => {
    const track = { received: 0, at: 0 };
    expect(updateSpeed(track, 4_000_000, 3)).toEqual({ track });
    expect(updateSpeed(track, 4_000_000, 999)).toEqual({ track });
  });

  it('measures over the whole window, so a burst of events is not read as a burst of speed', () => {
    // 4 MB arrived over 250 ms and was seen 3 ms apart: still 16 MB/s once a second has passed
    let r = updateSpeed({ received: 0, at: 0 }, 4_000_000, 3);
    r = updateSpeed(r.track, 8_000_000, 6);
    r = updateSpeed(r.track, 16_000_000, 1000);
    expect(r.speedBps).toBe(16_000_000);
    expect(r.track).toEqual({ received: 16_000_000, at: 1000 });
  });

  it('never reports a negative speed', () => {
    expect(updateSpeed({ received: 500, at: 0 }, 100, 2000).speedBps).toBe(0);
  });
});
