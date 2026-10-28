import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermanentError, redial, redialDelay } from './redial';

describe('redial', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports false without dialling when told to stop while waiting', async () => {
    const dial = vi.fn();
    let stopped = false;
    const result = redial(dial, () => stopped);
    stopped = true;
    await vi.advanceTimersByTimeAsync(redialDelay(0));
    expect(await result).toBe(false);
    expect(dial).not.toHaveBeenCalled();
  });

  it('keeps trying through ordinary failures and resolves true once connected', async () => {
    const dial = vi.fn().mockRejectedValueOnce(new Error('refused')).mockResolvedValueOnce(undefined);
    const result = redial(dial, () => false);
    await vi.advanceTimersByTimeAsync(redialDelay(0));
    await vi.advanceTimersByTimeAsync(redialDelay(1));
    expect(await result).toBe(true);
    expect(dial).toHaveBeenCalledTimes(2);
  });

  it('gives up at once on a permanent error', async () => {
    const dial = vi.fn().mockRejectedValue(new PermanentError('bad token'));
    const result = redial(dial, () => false);
    const assertion = expect(result).rejects.toThrow('bad token');
    await vi.advanceTimersByTimeAsync(redialDelay(0));
    await assertion;
    expect(dial).toHaveBeenCalledTimes(1);
  });
});
