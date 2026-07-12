import { describe, it, expect } from 'vitest';
import { parseIrcLine } from './parseLine.js';

describe('parseIrcLine', () => {
  it('parses PRIVMSG to a channel', () => {
    expect(parseIrcLine(':alice!u@host PRIVMSG #general :hello there')).toEqual({
      type: 'PRIVMSG', nick: 'alice', target: '#general', text: 'hello there',
    });
  });

  it('parses JOIN without a leading colon on the channel', () => {
    expect(parseIrcLine(':bob!u@host JOIN #general')).toEqual({
      type: 'JOIN', nick: 'bob', channel: '#general',
    });
  });

  it('parses JOIN with a leading colon on the channel', () => {
    expect(parseIrcLine(':bob!u@host JOIN :#general')).toEqual({
      type: 'JOIN', nick: 'bob', channel: '#general',
    });
  });

  it('parses PART with a reason', () => {
    expect(parseIrcLine(':carol!u@host PART #general :bye')).toEqual({
      type: 'PART', nick: 'carol', channel: '#general', reason: 'bye',
    });
  });

  it('parses PART without a reason', () => {
    expect(parseIrcLine(':carol!u@host PART #general')).toEqual({
      type: 'PART', nick: 'carol', channel: '#general', reason: undefined,
    });
  });

  it('parses KICK with a reason', () => {
    expect(parseIrcLine(':alice!u@host KICK #general bob :spamming')).toEqual({
      type: 'KICK', by: 'alice', channel: '#general', nick: 'bob', reason: 'spamming',
    });
  });

  it('parses KICK without a reason', () => {
    expect(parseIrcLine(':alice!u@host KICK #general bob')).toEqual({
      type: 'KICK', by: 'alice', channel: '#general', nick: 'bob', reason: undefined,
    });
  });

  it('parses QUIT', () => {
    expect(parseIrcLine(':dave!u@host QUIT :goodbye')).toEqual({
      type: 'QUIT', nick: 'dave', reason: 'goodbye',
    });
  });

  it('parses NICK with a leading colon on the new nick', () => {
    expect(parseIrcLine(':eve!u@host NICK :eve2')).toEqual({
      type: 'NICK', oldNick: 'eve', newNick: 'eve2',
    });
  });

  it('parses NICK without a leading colon on the new nick', () => {
    expect(parseIrcLine(':eve!u@host NICK eve2')).toEqual({
      type: 'NICK', oldNick: 'eve', newNick: 'eve2',
    });
  });

  it('parses a 353 NAMES reply with mixed status symbols', () => {
    expect(parseIrcLine(':irc.example.net 353 me = #general :~alice &bob @carol %dave +eve frank')).toEqual({
      type: 'NAMREPLY',
      channel: '#general',
      users: [
        { nick: 'alice', privilege: 'owner' },
        { nick: 'bob', privilege: 'admin' },
        { nick: 'carol', privilege: 'op' },
        { nick: 'dave', privilege: 'halfop' },
        { nick: 'eve', privilege: 'voice' },
        { nick: 'frank', privilege: 'none' },
      ],
    });
  });

  it('parses a 366 end-of-names marker', () => {
    expect(parseIrcLine(':irc.example.net 366 me #general :End of /NAMES list.')).toEqual({
      type: 'ENDOFNAMES', channel: '#general',
    });
  });

  it('parses a channel MODE granting a privilege', () => {
    expect(parseIrcLine(':alice!u@host MODE #general +o bob')).toEqual({
      type: 'MODE',
      channel: '#general',
      changes: [{ nick: 'bob', privilege: 'op', granted: true }],
    });
  });

  it('parses a channel MODE with mixed grants and revokes for multiple nicks', () => {
    expect(parseIrcLine(':alice!u@host MODE #general +o-v bob carol')).toEqual({
      type: 'MODE',
      channel: '#general',
      changes: [
        { nick: 'bob', privilege: 'op', granted: true },
        { nick: 'carol', privilege: 'voice', granted: false },
      ],
    });
  });

  it('extracts a privilege grant bundled with a known list/key/limit mode', () => {
    expect(parseIrcLine(':alice!u@host MODE #general +ok bob secretkey')).toEqual({
      type: 'MODE',
      channel: '#general',
      changes: [{ nick: 'bob', privilege: 'op', granted: true }],
    });
  });

  it('does not consume an argument for a ban set alongside a privilege grant', () => {
    expect(parseIrcLine(':alice!u@host MODE #general +ob bob carol!*@*')).toEqual({
      type: 'MODE',
      channel: '#general',
      changes: [{ nick: 'bob', privilege: 'op', granted: true }],
    });
  });

  it('only consumes a limit argument when the limit is being set, not unset', () => {
    expect(parseIrcLine(':alice!u@host MODE #general +l-o 50 bob')).toEqual({
      type: 'MODE',
      channel: '#general',
      changes: [{ nick: 'bob', privilege: 'op', granted: false }],
    });
  });

  it('skips known no-argument flags without losing a later privilege change', () => {
    expect(parseIrcLine(':alice!u@host MODE #general +nto bob')).toEqual({
      type: 'MODE',
      channel: '#general',
      changes: [{ nick: 'bob', privilege: 'op', granted: true }],
    });
  });

  it('returns null when no privilege changes are found', () => {
    expect(parseIrcLine(':alice!u@host MODE #general +k secretkey')).toBeNull();
  });

  it('stops at a fully unrecognized letter but keeps changes found before it', () => {
    expect(parseIrcLine(':alice!u@host MODE #general +oZ bob mystery')).toEqual({
      type: 'MODE',
      channel: '#general',
      changes: [{ nick: 'bob', privilege: 'op', granted: true }],
    });
  });

  it('returns null for unrecognized lines', () => {
    expect(parseIrcLine('PING :irc.example.net')).toBeNull();
    expect(parseIrcLine(':irc.example.net 001 me :Welcome')).toBeNull();
    expect(parseIrcLine('garbage')).toBeNull();
  });
});
