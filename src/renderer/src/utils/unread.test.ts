import { describe, expect, it } from 'vitest';
import type { Channel, Message } from '../types';
import { computeAwayStats } from './unread';

const ch = (id: string, extra: Partial<Channel> = {}): Channel => ({ id, name: id.slice(1), isLog: false, ...extra });
const msg = (nick: string, at: number, extra: Partial<Message> = {}): Message => ({
  id: at,
  nick,
  text: 'x',
  timestamp: new Date(at),
  ...extra,
});

describe('computeAwayStats', () => {
  const messages: Record<string, Message[]> = {
    '#a': [msg('bob', 100), msg('bob', 200), msg('amy', 300), msg('', 400, { system: true })],
    '#b': [msg('bob', 100)],
  };
  const messagesOf = (id: string) => messages[id] ?? [];

  it('counts unseen messages and distinct people, ignoring system lines', () => {
    const stats = computeAwayStats([ch('#a')], '#other', () => 150, messagesOf);
    expect(stats['#a']).toEqual({ count: 2, people: 2 });
  });

  it('omits channels with nothing new', () => {
    expect(computeAwayStats([ch('#b')], '#other', () => 100, messagesOf)).toEqual({});
  });

  it('never counts the channel on screen, or the log', () => {
    const stats = computeAwayStats([ch('#a'), ch('#log', { isLog: true })], '#a', () => 0, messagesOf);
    expect(stats).toEqual({});
  });
});
