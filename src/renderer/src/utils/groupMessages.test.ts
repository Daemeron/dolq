import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { continuesGroup, groupAround } from './groupMessages';

const MIN = 60_000;
const msg = (nick: string, minute: number, extra: Partial<Message> = {}): Message => ({
  id: minute,
  nick,
  text: 'hi',
  timestamp: new Date(minute * MIN),
  ...extra,
});

describe('continuesGroup', () => {
  it('starts a group when there is no previous line', () => {
    expect(continuesGroup(undefined, msg('mira', 0))).toBe(false);
  });

  it('groups the same sender within five minutes', () => {
    expect(continuesGroup(msg('mira', 0), msg('mira', 5))).toBe(true);
  });

  it('breaks after more than five minutes', () => {
    expect(continuesGroup(msg('mira', 0), msg('mira', 6))).toBe(false);
  });

  it('measures the gap from the previous line, so a steady chat stays grouped', () => {
    expect(continuesGroup(msg('mira', 4), msg('mira', 8))).toBe(true);
  });

  it('breaks when someone else speaks', () => {
    expect(continuesGroup(msg('mira', 0), msg('tomas', 1))).toBe(false);
  });

  it('never groups system lines, notices, actions or pack lists, nor lines after them', () => {
    for (const extra of [{ system: true }, { notice: true }, { action: true }, { xdccPack: true }, { isRaw: true }]) {
      expect(continuesGroup(msg('mira', 0), msg('mira', 1, extra))).toBe(false);
      expect(continuesGroup(msg('mira', 0, extra), msg('mira', 1))).toBe(false);
    }
  });

  it('does not group out-of-order timestamps', () => {
    expect(continuesGroup(msg('mira', 5), msg('mira', 1))).toBe(false);
  });
});

describe('groupAround', () => {
  const lines = [msg('mira', 0), msg('jon', 1), msg('jon', 2), msg('jon', 3), msg('mira', 4)];
  it('is the whole run from one sender, whichever of its lines is asked about', () => {
    for (const i of [1, 2, 3]) expect(groupAround(lines, i).map((m) => m.timestamp.getTime() / MIN)).toEqual([1, 2, 3]);
  });
  it('is just the line when another sender is on either side', () => {
    expect(groupAround(lines, 0)).toHaveLength(1);
    expect(groupAround(lines, 4)).toHaveLength(1);
  });
  it('stops where more than five minutes pass', () => {
    const slow = [msg('jon', 0), msg('jon', 1), msg('jon', 7)];
    expect(groupAround(slow, 0)).toHaveLength(2);
    expect(groupAround(slow, 2)).toHaveLength(1);
  });
});
