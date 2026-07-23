import { describe, it, expect } from 'vitest';
import { buildServerId, parseServerId } from './server';

describe('buildServerId', () => {
  it('joins a regular hostname and port', () => {
    expect(buildServerId('irc.libera.chat', 6667)).toBe('irc.libera.chat:6667');
  });

  it('joins a bare IPv6 literal and port', () => {
    expect(buildServerId('::1', 6667)).toBe('::1:6667');
  });

  it('strips brackets from a bracketed IPv6 literal', () => {
    expect(buildServerId('[::1]', 6667)).toBe('::1:6667');
  });

  it('strips brackets from a full bracketed IPv6 address', () => {
    expect(buildServerId('[2001:db8::1]', '6697')).toBe('2001:db8::1:6697');
  });
});

describe('parseServerId', () => {
  it('splits a regular hostname and port', () => {
    expect(parseServerId('irc.libera.chat:6667')).toEqual({ host: 'irc.libera.chat', port: 6667 });
  });

  it('splits a bare IPv6 literal and port on the last colon', () => {
    expect(parseServerId('::1:6667')).toEqual({ host: '::1', port: 6667 });
  });

  it('splits a full IPv6 address and port on the last colon', () => {
    expect(parseServerId('2001:db8::1:6697')).toEqual({ host: '2001:db8::1', port: 6697 });
  });

  it('round-trips through buildServerId for an IPv6 host', () => {
    const id = buildServerId('2001:db8::1', 6697);
    expect(parseServerId(id)).toEqual({ host: '2001:db8::1', port: 6697 });
  });
});
