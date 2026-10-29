import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { NavLocation } from '../utils/navHistory';
import { useNavHistory } from './useNavHistory';

const chat = (channelId: string): NavLocation => ({ kind: 'chat', serverId: 's', channelId });

function setup(reachable: (l: NavLocation) => boolean = () => true) {
  const go = vi.fn();
  const hook = renderHook(({ at }) => useNavHistory(at, go, reachable), { initialProps: { at: chat('#a') } });
  return { ...hook, go };
}

describe('useNavHistory', () => {
  it('starts with nowhere to go', () => {
    const { result } = setup();
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoForward).toBe(false);
  });

  it('remembers where you have been, and goes back and forward through it', () => {
    const { result, rerender, go } = setup();
    rerender({ at: chat('#b') });
    rerender({ at: { kind: 'dashboard' } as never });
    expect(result.current.canGoBack).toBe(true);
    act(() => result.current.goBack());
    expect(go).toHaveBeenLastCalledWith(chat('#b'));
    rerender({ at: chat('#b') });
    expect(result.current.canGoForward).toBe(true);
    act(() => result.current.goBack());
    expect(go).toHaveBeenLastCalledWith(chat('#a'));
    rerender({ at: chat('#a') });
    expect(result.current.canGoBack).toBe(false);
    act(() => result.current.goForward());
    expect(go).toHaveBeenLastCalledWith(chat('#b'));
  });

  it('does not record the places it takes you to as new visits', () => {
    const { result, rerender } = setup();
    rerender({ at: chat('#b') });
    act(() => result.current.goBack());
    rerender({ at: chat('#a') });
    // still able to go forward: going back did not push a new entry and cut the future off
    expect(result.current.canGoForward).toBe(true);
  });

  it('skips places that no longer exist, and does nothing when none is left', () => {
    let gone = false;
    const { result, rerender, go } = setup((l) => !(gone && l.kind === 'chat' && l.channelId === '#b'));
    rerender({ at: chat('#b') });
    rerender({ at: chat('#c') });
    gone = true;
    act(() => result.current.goBack());
    expect(go).toHaveBeenLastCalledWith(chat('#a'));
    go.mockClear();
    rerender({ at: chat('#a') });
    act(() => result.current.goBack());
    expect(go).not.toHaveBeenCalled();
  });

  it('going to where it already is leaves no stale mark behind', () => {
    const { result, rerender } = setup();
    rerender({ at: chat('#b') });
    rerender({ at: chat('#a') });
    rerender({ at: chat('#b') });
    // back from #b skips to #a; the app is already showing... then a later normal visit is still recorded
    act(() => result.current.goBack());
    rerender({ at: chat('#a') });
    rerender({ at: chat('#z') });
    expect(result.current.canGoBack).toBe(true);
    act(() => result.current.goBack());
    expect(result.current.canGoForward).toBe(true);
  });
});
