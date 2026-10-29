import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import type { MembershipKind } from './eventMessages';
import { hiddenByFold, membershipRuns, summarizeRun } from './membershipGroups';

let id = 0;
const at = (day: number, text: string, membership?: MembershipKind): Message => ({
  id: ++id,
  nick: membership ? '' : 'mira',
  text,
  timestamp: new Date(2026, 9, day, 12, id),
  system: !!membership,
  membership,
});
const join = (nick: string, day = 1) => at(day, `${nick} joined`, 'join');
const left = (nick: string, day = 1) => at(day, `${nick} left (bye)`, 'part');
const quit = (nick: string, day = 1) => at(day, `${nick} quit (Ping timeout)`, 'quit');
const chat = (day = 1) => at(day, 'hello');

describe('membershipRuns', () => {
  it('folds three or more membership lines in a row, led by the first', () => {
    const a = join('a');
    const b = left('b');
    const c = quit('c');
    const { runs, followers } = membershipRuns([chat(), a, b, c, chat()]);
    expect([...runs.keys()]).toEqual([a.id]);
    expect(runs.get(a.id)).toEqual([a, b, c]);
    expect([...followers]).toEqual([
      [b.id, a.id],
      [c.id, a.id],
    ]);
  });

  it('leaves short runs alone, and splits runs at a chat line', () => {
    const { runs } = membershipRuns([join('a'), join('b'), chat(), join('c'), join('d')]);
    expect(runs.size).toBe(0);
  });

  it('never folds a day change into a run, so the day divider stays visible', () => {
    const { runs } = membershipRuns([join('a', 1), join('b', 1), join('c', 2), join('d', 2)]);
    expect(runs.size).toBe(0);
    const longer = membershipRuns([join('a', 1), join('b', 1), join('c', 1), join('d', 2), join('e', 2), join('f', 2)]);
    expect(longer.runs.size).toBe(2);
  });

  it('is empty for no messages', () => {
    expect(membershipRuns([]).runs.size).toBe(0);
  });
});

describe('hiddenByFold', () => {
  const followers = new Map([[2, 1]]);
  it('hides a follower of a closed run only', () => {
    expect(hiddenByFold(followers, 2, () => false)).toBe(true);
    expect(hiddenByFold(followers, 2, (first) => first === 1)).toBe(false);
    expect(hiddenByFold(followers, 1, () => false)).toBe(false);
    expect(hiddenByFold(followers, 9, () => false)).toBe(false);
  });
});

describe('summarizeRun', () => {
  it('lists who joined, left and quit', () => {
    expect(summarizeRun([join('nolden'), left('warrior'), quit('seeker24')])).toBe(
      'nolden joined · warrior left · seeker24 quit',
    );
  });

  it('names up to three people, then counts the rest', () => {
    expect(summarizeRun([join('a'), join('b')])).toBe('a and b joined');
    expect(summarizeRun([join('a'), join('b'), join('c')])).toBe('a, b and c joined');
    expect(summarizeRun([join('a'), join('b'), join('c'), join('d'), join('e')])).toBe('a, b and 3 others joined');
  });

  it('counts a person once, and reports nick changes', () => {
    expect(summarizeRun([join('a'), left('a'), join('a')])).toBe('a joined · a left');
    expect(summarizeRun([at(1, 'old is now known as new', 'nick'), join('x'), join('y')])).toBe(
      'x and y joined · old changed nick',
    );
  });
});
