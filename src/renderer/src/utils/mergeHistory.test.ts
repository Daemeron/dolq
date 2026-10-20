import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { mergeHistory } from './mergeHistory';

const at = (s: number) => new Date(1_700_000_000_000 + s * 1000);
const msg = (id: number, nick: string, text: string, s: number, extra: Partial<Message> = {}): Message => ({
  id,
  nick,
  text,
  timestamp: at(s),
  ...extra,
});

describe('mergeHistory', () => {
  it('prepends history when nothing arrived live', () => {
    const history = [msg(1, 'a', 'hi', 0)];
    expect(mergeHistory(history, [])).toEqual(history);
  });

  it('drops history entries that also arrived live', () => {
    const live = [msg(100, 'a', 'hi', 1)];
    const merged = mergeHistory([msg(1, 'b', 'old', -60), msg(2, 'a', 'hi', 0)], live);
    expect(merged.map((m) => m.id)).toEqual([1, 100]);
  });

  it('keeps a repeated line sent much later', () => {
    const merged = mergeHistory([msg(1, 'a', 'hi', 0)], [msg(100, 'a', 'hi', 60)]);
    expect(merged).toHaveLength(2);
  });

  it('does not treat an action or notice as the same as chat', () => {
    const merged = mergeHistory([msg(1, 'a', 'waves', 0, { action: true })], [msg(100, 'a', 'waves', 0)]);
    expect(merged).toHaveLength(2);
  });
});
