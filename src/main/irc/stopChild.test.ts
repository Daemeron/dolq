import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { stopChild } from './stopChild';

function fakeChild(state: { exitCode: number | null; signalCode: string | null }, exitsOnTerm: boolean) {
  const emitter = new EventEmitter();
  const kill = vi.fn((sig: string) => {
    if (sig === 'SIGTERM' && exitsOnTerm) queueMicrotask(() => emitter.emit('exit'));
    if (sig === 'SIGKILL') queueMicrotask(() => emitter.emit('exit'));
    return true;
  });
  return Object.assign(emitter, state, { kill }) as unknown as ChildProcess & { kill: typeof kill };
}

describe('stopChild', () => {
  it('returns at once for a child that already exited', async () => {
    const child = fakeChild({ exitCode: 1, signalCode: null }, false);
    await stopChild(child, 10);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('terminates a running child and waits for exit', async () => {
    const child = fakeChild({ exitCode: null, signalCode: null }, true);
    await stopChild(child, 1000);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('kills a child that ignores SIGTERM after the grace period', async () => {
    vi.useFakeTimers();
    const child = fakeChild({ exitCode: null, signalCode: null }, false);
    const stopped = stopChild(child, 500);
    await vi.advanceTimersByTimeAsync(500);
    await stopped;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    vi.useRealTimers();
  });
});
