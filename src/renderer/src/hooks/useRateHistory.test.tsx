import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRateHistory } from './useRateHistory';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useRateHistory', () => {
  it('samples the current rates on every tick, newest last, while active', () => {
    const { result, rerender } = renderHook(({ rates }) => useRateHistory(rates, true, 1000), {
      initialProps: { rates: { down: 10, up: 1 } },
    });
    act(() => vi.advanceTimersByTime(1000));
    rerender({ rates: { down: 30, up: 0 } });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.map((s) => [s.down, s.up])).toEqual([
      [10, 1],
      [30, 0],
    ]);
  });

  it('keeps only the latest samples', () => {
    const { result } = renderHook(() => useRateHistory({ down: 1, up: 1 }, true, 1000, 3));
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toHaveLength(3);
  });

  it('keeps sampling in the background, and shows it all once active again', () => {
    const { result, rerender } = renderHook(({ active }) => useRateHistory({ down: 5, up: 0 }, active, 1000), {
      initialProps: { active: false },
    });
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current).toEqual([]);
    rerender({ active: true });
    expect(result.current).toHaveLength(3);
  });
});
