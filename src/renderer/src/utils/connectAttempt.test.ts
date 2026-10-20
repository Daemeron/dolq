import { describe, expect, it } from 'vitest';
import { attemptConnect } from './connectAttempt';

describe('attemptConnect', () => {
  it('goes connecting then connected on success', async () => {
    const seen: string[] = [];
    const err = await attemptConnect(
      's',
      (_, st) => seen.push(st),
      async () => undefined,
    );
    expect(err).toBeNull();
    expect(seen).toEqual(['connecting', 'connected']);
  });

  it('falls back to disconnected and returns the message when the dial fails', async () => {
    const seen: string[] = [];
    const err = await attemptConnect(
      's',
      (_, st) => seen.push(st),
      async () => {
        throw new Error('dial tcp: no such host');
      },
    );
    expect(err).toBe('dial tcp: no such host');
    expect(seen).toEqual(['connecting', 'disconnected']);
  });
});
