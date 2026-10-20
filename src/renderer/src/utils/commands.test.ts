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
