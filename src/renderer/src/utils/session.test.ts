import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { startsNewSession } from './session';

const line = (text: string): Message => ({ id: 1, nick: '', text, timestamp: new Date(0), isRaw: true });

describe('startsNewSession', () => {
  it('is true for the line after a connection ended', () => {
    expect(startsNewSession(line('*** Disconnected'))).toBe(true);
    expect(startsNewSession(line('*** Connection lost - reconnecting...'))).toBe(true);
  });

  it('is false at the start, and after anything else', () => {
    expect(startsNewSession(undefined)).toBe(false);
    expect(startsNewSession(line('*** Reconnected'))).toBe(false);
    expect(startsNewSession(line(':srv 001 me :*** Disconnected'))).toBe(false);
    expect(startsNewSession(line('hello'))).toBe(false);
  });
});
