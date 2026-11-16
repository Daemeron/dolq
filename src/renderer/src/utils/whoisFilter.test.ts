import { describe, expect, it } from 'vitest';
import { createWhoisFilter } from './whoisFilter';

const whois = [
  ':irc.uworld.se 311 daemeron tazmanian tazmani n-devil * :Scott',
  ':irc.uworld.se 319 daemeron tazmanian :@#news',
  ':irc.uworld.se 312 daemeron tazmanian *.rizon.net :Where are you?',
  ':irc.uworld.se 716 daemeron tazmanian :is in +G mode (server side ignore with the exception of common channels)',
  ':irc.uworld.se 307 daemeron tazmanian :has identified for this nick',
  ':irc.uworld.se 318 daemeron tazmanian :End of /WHOIS list.',
];

describe('createWhoisFilter', () => {
  it('hides every line of a WHOIS', () => {
    const hide = createWhoisFilter();
    expect(whois.map(hide)).toEqual([true, true, true, true, true, true]);
  });

  it('keeps the lines of a /whowas, including the server line they share with a WHOIS', () => {
    const hide = createWhoisFilter();
    expect(hide(':s 314 me old user host * :Real Name')).toBe(false);
    expect(hide(':s 312 me old *.rizon.net :Mon Nov 16 09:30:00 2026')).toBe(false);
    expect(hide(':s 369 me old :End of WHOWAS')).toBe(false);
  });

  it('hides a 312 only for the person whose WHOIS is under way, and only until it ends', () => {
    const hide = createWhoisFilter();
    hide(':s 311 me alice a b * :A');
    expect(hide(':s 312 me bob *.rizon.net :date')).toBe(false);
    expect(hide(':s 312 me ALICE *.rizon.net :x')).toBe(true);
    hide(':s 318 me alice :End of /WHOIS list.');
    expect(hide(':s 312 me alice *.rizon.net :date')).toBe(false);
  });

  it('leaves every other line, and errors such as no such nick, alone', () => {
    const hide = createWhoisFilter();
    expect(hide(':s 401 me ghost :No such nick/channel')).toBe(false);
    expect(hide(':s 305 me :You are no longer marked as being away')).toBe(false);
    expect(hide('PING :x')).toBe(false);
    expect(hide(':s NOTICE me :hello')).toBe(false);
  });
});
