import { describe, expect, it } from 'vitest';
import { parseIrcUrl } from './ircUrl';

describe('parseIrcUrl', () => {
  it('parses a bare host with default port', () => {
    expect(parseIrcUrl('irc://irc.libera.chat')).toEqual({
      host: 'irc.libera.chat', port: 6667, secure: false, channel: undefined,
    });
  });

  it('parses ircs with its own default port', () => {
    expect(parseIrcUrl('ircs://irc.libera.chat')).toEqual({
      host: 'irc.libera.chat', port: 6697, secure: true, channel: undefined,
    });
  });

  it('honors an explicit port on either scheme', () => {
    expect(parseIrcUrl('irc://irc.libera.chat:7000')?.port).toBe(7000);
    expect(parseIrcUrl('ircs://irc.libera.chat:7001')?.port).toBe(7001);
  });

  it('adds the # a bare channel path segment is missing', () => {
    expect(parseIrcUrl('irc://irc.libera.chat/dolq')?.channel).toBe('#dolq');
  });

  it('decodes a percent-encoded #', () => {
    expect(parseIrcUrl('irc://irc.libera.chat/%23dolq')?.channel).toBe('#dolq');
  });

  it('accepts a literal unencoded # (lands in the URL fragment, not the path)', () => {
    expect(parseIrcUrl('irc://irc.libera.chat/#dolq')?.channel).toBe('#dolq');
  });

  it('drops a ",needkey"-style modifier rather than treating it as part of the name', () => {
    expect(parseIrcUrl('irc://irc.libera.chat/dolq,needkey')?.channel).toBe('#dolq');
  });

  it('has no channel at all when the URL names none', () => {
    expect(parseIrcUrl('irc://irc.libera.chat/')?.channel).toBeUndefined();
  });

  it('rejects a non-irc(s) scheme', () => {
    expect(parseIrcUrl('https://irc.libera.chat/dolq')).toBeNull();
  });

  it('rejects a URL with no host', () => {
    expect(parseIrcUrl('irc:///dolq')).toBeNull();
  });

  it('rejects garbage input instead of throwing', () => {
    expect(parseIrcUrl('not a url')).toBeNull();
  });
});
