import { describe, expect, it } from 'vitest';
import { ipcErrorMessage } from './ipcError';

describe('ipcErrorMessage', () => {
  it.each([
    [
      new Error("Error invoking remote method 'irc:xdccAccept': Error: not enough room in /data/downloads"),
      'not enough room in /data/downloads',
    ],
    [new Error("Error invoking remote method 'irc:xdccAccept': backend not connected"), 'backend not connected'],
    [new Error('plain failure'), 'plain failure'],
    ['a string', 'a string'],
  ])('reads %s as %s', (err, message) => {
    expect(ipcErrorMessage(err)).toBe(message);
  });
});
