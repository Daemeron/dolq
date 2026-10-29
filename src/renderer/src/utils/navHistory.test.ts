import { describe, expect, it } from 'vitest';
import { locationKey, type NavLocation, startHistory, step, visit } from './navHistory';

const chat = (channelId: string): NavLocation => ({ kind: 'chat', serverId: 's', channelId });
const dash: NavLocation = { kind: 'dashboard' };

describe('navHistory', () => {
  it('keys a location by what it shows', () => {
    expect(locationKey(dash)).toBe('dashboard');
    expect(locationKey(chat('#a'))).toBe('chat:s:#a');
  });

  it('appends new places, and ignores the place it is already at', () => {
    let h = startHistory(chat('#a'));
    h = visit(h, chat('#b'));
    expect(visit(h, chat('#b'))).toBe(h);
    expect(h.entries.map(locationKey)).toEqual(['chat:s:#a', 'chat:s:#b']);
    expect(h.index).toBe(1);
  });

  it('drops what was ahead when you go somewhere new from further back', () => {
    let h = startHistory(chat('#a'));
    h = visit(h, chat('#b'));
    h = visit(h, dash);
    h = { ...h, index: 0 };
    h = visit(h, chat('#c'));
    expect(h.entries.map(locationKey)).toEqual(['chat:s:#a', 'chat:s:#c']);
  });

  it('keeps only the latest 50 places', () => {
    let h = startHistory(chat('#0'));
    for (let i = 1; i < 80; i++) h = visit(h, chat(`#${i}`));
    expect(h.entries).toHaveLength(50);
    expect(locationKey(h.entries[h.index])).toBe('chat:s:#79');
    expect(locationKey(h.entries[0])).toBe('chat:s:#30');
  });

  it('steps to the nearest place that still exists, or nowhere', () => {
    let h = startHistory(chat('#a'));
    h = visit(h, chat('#gone'));
    h = visit(h, chat('#c'));
    const reachable = (l: NavLocation) => locationKey(l) !== 'chat:s:#gone';
    expect(step(h, -1, reachable)).toBe(0);
    expect(step(h, 1, reachable)).toBeNull();
    expect(step({ ...h, index: 0 }, -1, reachable)).toBeNull();
    expect(step({ ...h, index: 0 }, 1, reachable)).toBe(2);
  });
});
