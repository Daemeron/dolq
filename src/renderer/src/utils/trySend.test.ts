import { describe, expect, it } from 'vitest';
import { restoreDraft, trySend } from './trySend';

describe('trySend', () => {
  it('reports success for sync and async senders', async () => {
    expect(await trySend('hi', () => undefined)).toEqual({ ok: true });
    expect(await trySend('hi', async () => undefined)).toEqual({ ok: true });
  });

  it('turns a rejection into an error result', async () => {
    const result = await trySend('hi', async () => {
      throw new Error('backend not connected');
    });
    expect(result).toEqual({ ok: false, error: 'backend not connected' });
  });

  it('turns a sync throw into an error result', async () => {
    const result = await trySend('hi', () => {
      throw new Error('boom');
    });
    expect(result).toEqual({ ok: false, error: 'boom' });
  });
});

describe('restoreDraft', () => {
  it('brings the failed text back into an empty input', () => {
    expect(restoreDraft('', 'hello')).toBe('hello');
  });

  it('keeps what the user has typed since', () => {
    expect(restoreDraft('new text', 'hello')).toBe('new text');
  });
});
