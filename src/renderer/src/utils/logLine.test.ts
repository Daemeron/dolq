import { describe, expect, it } from 'vitest';
import { logLineParts } from './logLine';

describe('logLineParts', () => {
  it('splits a line from a server into source, command and the rest', () => {
    expect(logLineParts(':irc.uworld.se 001 me :Welcome to Rizon')).toEqual({
      prefix: ':irc.uworld.se',
      command: '001',
      params: 'me :Welcome to Rizon',
      tone: 'welcome',
    });
  });
  it('keeps message tags with the source', () => {
    expect(logLineParts('@time=1 :a.b NOTICE * :*** Checking Ident')).toMatchObject({
      prefix: '@time=1 :a.b',
      command: 'NOTICE',
      tone: 'notice',
    });
  });
  it('reads a line with no source from its first word', () => {
    expect(logLineParts('ERROR :Closing Link')).toMatchObject({
      prefix: '',
      command: 'ERROR',
      params: ':Closing Link',
    });
  });
  it.each([
    ['002', 'info'],
    ['372', 'motd'],
    ['375', 'banner'],
    ['376', 'banner'],
    ['CAP', 'cap'],
    ['MODE', 'mode'],
    ['PRIVMSG', 'plain'],
    ['311', 'whois'],
    ['312', 'whois'],
    ['319', 'whois'],
    ['307', 'whois'],
    ['318', 'whois'],
    ['716', 'whois'],
    ['305', 'away'],
    ['306', 'away'],
    ['301', 'away'],
  ])('tones %s as %s', (command, tone) => {
    expect(logLineParts(`:s.example ${command} me :x`).tone).toBe(tone);
  });
});
