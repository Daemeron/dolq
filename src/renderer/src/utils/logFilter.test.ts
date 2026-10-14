import { describe, expect, it } from 'vitest';
import { isChannelScopedLine } from './logFilter';

describe('isChannelScopedLine', () => {
  it.each([
    ':alice!u@h PRIVMSG #chan :hello',
    ':alice!u@h PRIVMSG me :psst',
    ':alice!u@h JOIN :#chan',
    ':alice!u@h PART #chan :bye',
    ':op!u@h KICK #chan bob :spam',
    ':alice!u@h QUIT :Ping timeout',
    ':alice!u@h NICK :alicia',
    ':op!u@h MODE #chan +o bob',
    ':op!u@h TOPIC #chan :new topic',
    ':alice!u@h NOTICE #chan :hi all',
    ':alice!u@h NOTICE @#chan :ops only',
    ':alice!u@h AWAY :gone',
    ':srv 332 me #chan :topic',
    ':srv 333 me #chan op!u@h 1700000000',
    ':srv 353 me = #chan :me @op alice',
    ':srv 366 me #chan :End of /NAMES list.',
    '@time=2024-01-01T00:00:00Z :alice!u@h PRIVMSG #chan :tagged',
  ])('hides %s', (line) => {
    expect(isChannelScopedLine(line)).toBe(true);
  });

  it.each([
    ':srv 001 me :Welcome to the network',
    ':srv 372 me :- message of the day',
    ':srv 433 * me :Nickname is already in use',
    ':srv 404 me #chan :Cannot send to channel',
    ':NickServ!s@h NOTICE me :This nickname is registered',
    ':srv NOTICE * :*** Looking up your hostname',
    ':me!u@h MODE me +i',
    'PING :token',
    ':srv 311 me alice u h * :Alice',
    '*** Disconnected',
    '*** Connection lost - reconnecting...',
  ])('keeps %s', (line) => {
    expect(isChannelScopedLine(line)).toBe(false);
  });
});
