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
    expect(parseIrcLine(':irc.example.net 353 me = #general :alice @bob +carol dave')).toEqual({
      type: 'NAMREPLY',
      channel: '#general',
      users: [
        { nick: 'alice', isOp: false },
        { nick: 'bob', isOp: true },
        { nick: 'carol', isOp: false },
        { nick: 'dave', isOp: false },
      ],
    });
  });

  it('parses a 366 end-of-names marker', () => {
    expect(parseIrcLine(':irc.example.net 366 me #general :End of /NAMES list.')).toEqual({
      type: 'ENDOFNAMES', channel: '#general',
    });
  });

  it('returns null for unrecognized lines', () => {
    expect(parseIrcLine('PING :irc.example.net')).toBeNull();
    expect(parseIrcLine(':irc.example.net 001 me :Welcome')).toBeNull();
    expect(parseIrcLine('garbage')).toBeNull();
  });
});
