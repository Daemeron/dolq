import { describe, expect, it } from 'vitest';
import { takeAutoAccept, xdccRequestCount, xdccRequestKey, xdccRequestTarget, xdccSenderKey } from './xdcc';

describe('xdccRequestTarget', () => {
  it('finds the bot in a typed request', () => {
    expect(xdccRequestTarget('PRIVMSG Bot :xdcc send #5')).toBe('Bot');
    expect(xdccRequestTarget('PRIVMSG Bot :XDCC GET #5')).toBe('Bot');
    expect(xdccRequestTarget('PRIVMSG Bot :xdcc batch 1-3')).toBe('Bot');
  });

  it('ignores channel messages and other text', () => {
    expect(xdccRequestTarget('PRIVMSG #chan :xdcc send #5')).toBeNull();
    expect(xdccRequestTarget('PRIVMSG Bot :xdcc list')).toBeNull();
    expect(xdccRequestTarget('PRIVMSG Bot :please xdcc send #5')).toBeNull();
    expect(xdccRequestTarget('JOIN #chan')).toBeNull();
  });
});

describe('takeAutoAccept', () => {
  it('accepts a requested offer once when the option is on', () => {
    const requested = new Map([[xdccRequestKey('s1', 'Bot'), 1]]);
    expect(takeAutoAccept(true, false, requested, 's1', 'bot')).toBe(true);
    expect(takeAutoAccept(true, false, requested, 's1', 'bot')).toBe(false);
  });

  it('prompts for an unrequested offer from a stranger', () => {
    expect(takeAutoAccept(true, false, new Map(), 's1', 'bot')).toBe(false);
  });

  it('prompts when the request was made on another server', () => {
    expect(takeAutoAccept(true, false, new Map([[xdccRequestKey('s2', 'bot'), 1]]), 's1', 'bot')).toBe(false);
  });

  it('prompts when the option is off, and still consumes the request', () => {
    const requested = new Map([[xdccRequestKey('s1', 'bot'), 1]]);
    expect(takeAutoAccept(false, false, requested, 's1', 'bot')).toBe(false);
    expect(requested.size).toBe(0);
  });

  it('accepts a trusted nick whether or not it was requested and the option is off', () => {
    expect(takeAutoAccept(false, true, new Map(), 's1', 'bot')).toBe(true);
  });
});

describe('a batch request', () => {
  it('counts one expected offer per pack', () => {
    expect(xdccRequestCount('PRIVMSG Bot :XDCC BATCH 12698-12700,15943,16005')).toBe(5);
    expect(xdccRequestCount('PRIVMSG Bot :xdcc send #5')).toBe(1);
    expect(xdccRequestCount('PRIVMSG Bot :hello')).toBe(0);
  });

  it('is auto-accepted for every pack it brings, then no more', () => {
    const requested = new Map([[xdccRequestKey('s1', 'Bot'), 3]]);
    const accepted = [1, 2, 3, 4].map(() => takeAutoAccept(true, false, requested, 's1', 'bot'));
    expect(accepted).toEqual([true, true, true, false]);
  });
});

describe('xdccSenderKey', () => {
  it('uses the account, so a nick change keeps the same key', () => {
    expect(xdccSenderKey({ nick: 'Bot', host: 'a@b', account: 'Acct' })).toBe(
      xdccSenderKey({ nick: 'Bot2', host: 'c@d', account: 'acct' }),
    );
  });

  it('without an account needs both the nick and the host to match', () => {
    const k = xdccSenderKey({ nick: 'Bot', host: 'u@cloak' });
    expect(xdccSenderKey({ nick: 'bot', host: 'U@Cloak' })).toBe(k);
    expect(xdccSenderKey({ nick: 'Bot', host: 'u@other' })).not.toBe(k);
    expect(xdccSenderKey({ nick: 'Other', host: 'u@cloak' })).not.toBe(k);
  });

  it('is empty for a nick alone', () => {
    expect(xdccSenderKey({ nick: 'Bot' })).toBe('');
  });
});

import { queryXdccText } from './xdcc';

describe('queryXdccText', () => {
  it('drops the slash from an xdcc command only', () => {
    expect(queryXdccText('/xdcc send #5')).toBe('xdcc send #5');
    expect(queryXdccText('/XDCC batch 1-3')).toBe('XDCC batch 1-3');
    expect(queryXdccText('/msg a hi')).toBe('/msg a hi');
  });
});
