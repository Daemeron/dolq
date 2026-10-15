import { describe, expect, it } from 'vitest';
import { takeAutoAccept, xdccRequestKey, xdccRequestTarget, xdccSenderKey } from './xdcc';

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
    const requested = new Set([xdccRequestKey('s1', 'Bot')]);
    expect(takeAutoAccept(true, false, requested, 's1', 'bot')).toBe(true);
    expect(takeAutoAccept(true, false, requested, 's1', 'bot')).toBe(false);
  });

  it('prompts for an unrequested offer from a stranger', () => {
    expect(takeAutoAccept(true, false, new Set(), 's1', 'bot')).toBe(false);
  });

  it('prompts when the request was made on another server', () => {
    expect(takeAutoAccept(true, false, new Set([xdccRequestKey('s2', 'bot')]), 's1', 'bot')).toBe(false);
  });

  it('prompts when the option is off, and still consumes the request', () => {
    const requested = new Set([xdccRequestKey('s1', 'bot')]);
    expect(takeAutoAccept(false, false, requested, 's1', 'bot')).toBe(false);
    expect(requested.size).toBe(0);
  });

  it('accepts a trusted nick whether or not it was requested and the option is off', () => {
    expect(takeAutoAccept(false, true, new Set(), 's1', 'bot')).toBe(true);
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
