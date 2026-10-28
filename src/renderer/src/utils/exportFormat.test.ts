import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../../../shared/ipc';
import { formatEntry } from './exportFormat';

const TS = '1970-01-01T00:00:00.000Z';
const entry = (extra: Record<string, unknown>): HistoryEntry =>
  ({ id: 1, serverId: 's', channel: '#c', timestamp: 0, ...extra }) as unknown as HistoryEntry;
const fmt = (event: Record<string, unknown>) => formatEntry(entry({ event }));

describe('formatEntry', () => {
  it('formats raw lines', () => {
    expect(formatEntry(entry({ isRaw: true, line: ':srv 001' }))).toBe(`[${TS}] :srv 001`);
    expect(formatEntry(entry({ isRaw: true }))).toBe(`[${TS}] `);
  });

  it('formats chat, notices and actions', () => {
    expect(fmt({ type: 'PRIVMSG', nick: 'a', text: 'hi' })).toBe(`[${TS}] <a> hi`);
    expect(fmt({ type: 'NOTICE', nick: 'a', text: 'hi' })).toBe(`[${TS}] <a> hi`);
    expect(fmt({ type: 'ACTION', nick: 'a', text: 'waves' })).toBe(`[${TS}] * a waves`);
  });

  it('formats membership events, with and without a reason', () => {
    expect(fmt({ type: 'JOIN', nick: 'a', channel: '#c' })).toBe(`[${TS}] a joined #c`);
    expect(fmt({ type: 'PART', nick: 'a', channel: '#c' })).toBe(`[${TS}] a left #c`);
    expect(fmt({ type: 'PART', nick: 'a', channel: '#c', reason: 'bye' })).toBe(`[${TS}] a left #c (bye)`);
    expect(fmt({ type: 'QUIT', nick: 'a' })).toBe(`[${TS}] a quit`);
    expect(fmt({ type: 'QUIT', nick: 'a', reason: 'gone' })).toBe(`[${TS}] a quit (gone)`);
    expect(fmt({ type: 'NICK', oldNick: 'a', newNick: 'b' })).toBe(`[${TS}] a is now known as b`);
    expect(fmt({ type: 'KICK', nick: 'a', by: 'op' })).toBe(`[${TS}] a was kicked by op`);
    expect(fmt({ type: 'KICK', nick: 'a', by: 'op', reason: 'spam' })).toBe(`[${TS}] a was kicked by op (spam)`);
  });

  it('formats topics whether or not we know who set them', () => {
    expect(fmt({ type: 'TOPIC', nick: 'a', topic: 'x' })).toBe(`[${TS}] a set the topic: x`);
    expect(fmt({ type: 'TOPIC', topic: 'x' })).toBe(`[${TS}] Topic is the topic: x`);
  });

  it('formats pack lines', () => {
    expect(fmt({ type: 'XDCCPACK', nick: 'bot', number: 4, gets: 9, size: '1G', filename: 'f.iso' })).toBe(
      `[${TS}] <bot> #4 · 9x sent · 1G · f.iso`,
    );
  });

  it('falls back to JSON for events it has no wording for, and to blank for none', () => {
    expect(fmt({ type: 'MODE', x: 1 })).toBe(`[${TS}] {"type":"MODE","x":1}`);
    expect(formatEntry(entry({}))).toBe(`[${TS}] `);
  });
});
