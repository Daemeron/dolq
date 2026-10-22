import { describe, expect, it } from 'vitest';
import { reconcileStep } from './reconcile';

describe('reconcileStep', () => {
  it('syncs joined channels for a connected server', () => {
    expect(reconcileStep('connected')).toBe('sync');
  });

  it('leaves a server that is already reconnecting alone', () => {
    expect(reconcileStep('connecting')).toBe('wait');
  });

  it('connects a server the backend has no session for', () => {
    expect(reconcileStep('disconnected')).toBe('connect');
  });
});
