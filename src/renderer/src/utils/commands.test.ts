import { describe, expect, it } from 'vitest';
import { parseSlashCommand } from './commands';

const raw = (line: string) => ({ kind: 'raw', line });

describe('parseSlashCommand', () => {
  it('leaves ordinary text and escaped slashes alone', () => {
    expect(parseSlashCommand('hello', '#c')).toEqual({ kind: 'not-command' });
    expect(parseSlashCommand('//shrug', '#c')).toEqual({ kind: 'not-command' });
  });

  it('maps simple commands to IRC lines', () => {
    expect(parseSlashCommand('/nick bob', '#c')).toEqual(raw('NICK bob'));
    expect(parseSlashCommand('/topic new topic here', '#c')).toEqual(raw('TOPIC #c :new topic here'));
    expect(parseSlashCommand('/topic', '#c')).toEqual(raw('TOPIC #c'));
    expect(parseSlashCommand('/kick bob spamming', '#c')).toEqual(raw('KICK #c bob :spamming'));
    expect(parseSlashCommand('/notice bob hi there', '#c')).toEqual(raw('NOTICE bob :hi there'));
    expect(parseSlashCommand('/quote WHO #c', '#c')).toEqual(raw('WHO #c'));
  });

  it('parts the current channel by default, or a named one', () => {
    expect(parseSlashCommand('/part', '#c')).toEqual(raw('PART #c'));
    expect(parseSlashCommand('/part bye all', '#c')).toEqual(raw('PART #c :bye all'));
    expect(parseSlashCommand('/part #other bye', '#c')).toEqual(raw('PART #other :bye'));
  });

  it('targets the current channel for /mode unless one is given', () => {
    expect(parseSlashCommand('/mode +m', '#c')).toEqual(raw('MODE #c +m'));
    expect(parseSlashCommand('/mode #x +m', '#c')).toEqual(raw('MODE #x +m'));
  });

  it('never turns an unknown or incomplete command into chat text', () => {
    expect(parseSlashCommand('/wibble foo', '#c')).toEqual({ kind: 'unknown', name: 'wibble' });
    expect(parseSlashCommand('/nick', '#c')).toEqual({ kind: 'unknown', name: 'nick' });
  });
});

describe('parseSlashCommand: edges', () => {
  it('treats a lone slash as text', () => {
    expect(parseSlashCommand('/', '#c')).toEqual({ kind: 'not-command' });
  });

  it('asks for the channel modes with a bare /mode', () => {
    expect(parseSlashCommand('/mode', '#c')).toEqual(raw('MODE #c'));
  });

  it('kicks without a reason, and rejects /kick with no nick', () => {
    expect(parseSlashCommand('/kick bob', '#c')).toEqual(raw('KICK #c bob'));
    expect(parseSlashCommand('/kick', '#c')).toEqual({ kind: 'unknown', name: 'kick' });
  });

  it('invites into the current channel unless one is named', () => {
    expect(parseSlashCommand('/invite bob', '#c')).toEqual(raw('INVITE bob #c'));
    expect(parseSlashCommand('/invite bob #other', '#c')).toEqual(raw('INVITE bob #other'));
    expect(parseSlashCommand('/invite', '#c')).toEqual({ kind: 'unknown', name: 'invite' });
  });

  it('flags commands missing their arguments instead of sending half a line', () => {
    expect(parseSlashCommand('/nick', '#c')).toEqual({ kind: 'unknown', name: 'nick' });
    expect(parseSlashCommand('/notice bob', '#c')).toEqual({ kind: 'unknown', name: 'notice' });
    expect(parseSlashCommand('/raw', '#c')).toEqual({ kind: 'unknown', name: 'raw' });
    expect(parseSlashCommand('/frobnicate', '#c')).toEqual({ kind: 'unknown', name: 'frobnicate' });
  });

  it('maps the informational commands onto one line each', () => {
    expect(parseSlashCommand('/list >50', '#c')).toEqual(raw('LIST >50'));
    expect(parseSlashCommand('/list', '#c')).toEqual(raw('LIST'));
    expect(parseSlashCommand('/names', '#c')).toEqual(raw('NAMES #c'));
    expect(parseSlashCommand('/names', 'bob')).toEqual(raw('NAMES'));
    expect(parseSlashCommand('/who bob', '#c')).toEqual(raw('WHO bob'));
    expect(parseSlashCommand('/whowas bob', '#c')).toEqual(raw('WHOWAS bob'));
    expect(parseSlashCommand('/motd', '#c')).toEqual(raw('MOTD'));
    expect(parseSlashCommand('/version', '#c')).toEqual(raw('VERSION'));
    expect(parseSlashCommand('/version bob', '#c')).toEqual(raw('PRIVMSG bob :\x01VERSION\x01'));
    expect(parseSlashCommand('/ctcp bob time', '#c')).toEqual(raw('PRIVMSG bob :\x01TIME\x01'));
    expect(parseSlashCommand('/who', '#c')).toEqual({ kind: 'unknown', name: 'who' });
  });

  it('sets channel privileges and bans for the current channel', () => {
    expect(parseSlashCommand('/op bob', '#c')).toEqual(raw('MODE #c +o bob'));
    expect(parseSlashCommand('/deop bob al', '#c')).toEqual(raw('MODE #c -oo bob al'));
    expect(parseSlashCommand('/voice bob', '#c')).toEqual(raw('MODE #c +v bob'));
    expect(parseSlashCommand('/devoice bob', '#c')).toEqual(raw('MODE #c -v bob'));
    expect(parseSlashCommand('/ban *!*@bad.host', '#c')).toEqual(raw('MODE #c +b *!*@bad.host'));
    expect(parseSlashCommand('/unban *!*@bad.host', '#c')).toEqual(raw('MODE #c -b *!*@bad.host'));
    expect(parseSlashCommand('/op', '#c')).toEqual({ kind: 'unknown', name: 'op' });
  });

  it('talks to services', () => {
    expect(parseSlashCommand('/ns identify pw', '#c')).toEqual(raw('PRIVMSG NickServ :identify pw'));
    expect(parseSlashCommand('/chanserv op #c', '#c')).toEqual(raw('PRIVMSG ChanServ :op #c'));
    expect(parseSlashCommand('/ns', '#c')).toEqual({ kind: 'unknown', name: 'ns' });
  });

  it('turns /cycle and /kickban into two lines, only where a channel makes sense', () => {
    expect(parseSlashCommand('/cycle', '#c')).toEqual({ kind: 'lines', lines: ['PART #c', 'JOIN #c'] });
    expect(parseSlashCommand('/cycle', 'bob')).toEqual({ kind: 'unknown', name: 'cycle' });
    expect(parseSlashCommand('/kb bob spam', '#c')).toEqual({
      kind: 'lines',
      lines: ['MODE #c +b bob!*@*', 'KICK #c bob :spam'],
    });
    expect(parseSlashCommand('/kickban', '#c')).toEqual({ kind: 'unknown', name: 'kickban' });
  });
});
