import { describe, expect, it } from 'vitest';
import type { ConnectionStatus } from '../../../shared/ipc';
import { reconcileServers, reconcileStep } from './reconcile';

describe('reconcileStep', () => {
  it('syncs joined channels for a connected server, whether or not it connects on startup', () => {
    expect(reconcileStep('connected', true)).toBe('sync');
    expect(reconcileStep('connected', false)).toBe('sync');
  });

  it('leaves a server that is already reconnecting alone, whether or not it connects on startup', () => {
    expect(reconcileStep('connecting', true)).toBe('wait');
    expect(reconcileStep('connecting', false)).toBe('wait');
  });

  it('connects a server with no session when it is set to connect on startup', () => {
    expect(reconcileStep('disconnected', true)).toBe('connect');
  });

  it('leaves a server with no session disconnected when it is not set to connect on startup', () => {
    expect(reconcileStep('disconnected', false)).toBe('skip');
  });
});

describe('reconcileServers', () => {
  it('attaches every server before onAttached, and only then applies the steps', async () => {
    const calls: string[] = [];
    const statuses: Record<string, ConnectionStatus> = { a: 'disconnected', b: 'connected' };
    await reconcileServers(
      ['a', 'b'],
      async (s) => {
        calls.push(`status ${s}`);
        return statuses[s];
      },
      () => calls.push('attached'),
      async (s, status) => {
        calls.push(`apply ${s} ${status}`);
      },
    );
    expect(calls).toEqual(['status a', 'status b', 'attached', 'apply a disconnected', 'apply b connected']);
  });

  it('asks for all statuses at once rather than one after another', async () => {
    let pending = 0;
    let maxPending = 0;
    await reconcileServers(
      ['a', 'b', 'c'],
      async () => {
        pending++;
        maxPending = Math.max(maxPending, pending);
        await Promise.resolve();
        pending--;
        return 'connected';
      },
      () => {},
      async () => {},
    );
    expect(maxPending).toBe(3);
  });

  it('applies the steps one server at a time', async () => {
    const calls: string[] = [];
    await reconcileServers(
      ['a', 'b'],
      async () => 'disconnected',
      () => {},
      async (s) => {
        calls.push(`start ${s}`);
        await Promise.resolve();
        calls.push(`end ${s}`);
      },
    );
    expect(calls).toEqual(['start a', 'end a', 'start b', 'end b']);
  });
});
