import { describe, expect, it } from 'vitest';
import type { Channel, Message } from '../types';
import { canLoadOlder, dropServerPages, type HistoryPage, linesToStore, pagesToReload } from './historyPages';

const page = (serverId: string, channelId: string): HistoryPage => ({
  serverId,
  channelId,
  oldestId: 1,
  exhausted: false,
  loading: false,
});
const ch = (id: string, extra: Partial<Channel> = {}): Channel => ({ id, name: id, isLog: false, ...extra });

describe('dropServerPages', () => {
  it('drops every page of the server, including ones keyed without its id', () => {
    const pages = new Map([
      ['a:#foo', page('a', '#foo')],
      ['a:__log__', page('a', 'a:__log__')],
      ['dcc:1', page('a', 'dcc:1')],
      ['b:#foo', page('b', '#foo')],
    ]);
    dropServerPages(pages, 'a');
    expect([...pages.keys()]).toEqual(['b:#foo']);
  });
});

describe('pagesToReload', () => {
  it('reloads pages of channels that are still open', () => {
    const foo = page('a', '#foo');
    const pages = new Map([['a:#foo', foo]]);
    expect(pagesToReload(pages, { a: [ch('#foo')] })).toEqual([foo]);
    expect(pages.has('a:#foo')).toBe(true);
  });

  it('drops pages of closed channels and removed servers', () => {
    const pages = new Map([
      ['a:#foo', page('a', '#foo')],
      ['b:#bar', page('b', '#bar')],
    ]);
    expect(pagesToReload(pages, { a: [ch('#other')] })).toEqual([]);
    expect(pages.size).toBe(0);
  });

  it('keeps DCC chat pages without reloading them', () => {
    const pages = new Map([['dcc:1', page('a', 'dcc:1')]]);
    expect(pagesToReload(pages, { a: [ch('dcc:1', { isDCC: true })] })).toEqual([]);
    expect(pages.has('dcc:1')).toBe(true);
  });
});

describe('canLoadOlder', () => {
  it('allows a loaded page with more history behind it', () => {
    expect(canLoadOlder(page('a', '#foo'))).toBe(true);
  });

  it('blocks when there is no page yet', () => {
    expect(canLoadOlder(undefined)).toBe(false);
  });

  it('blocks while a page is loading', () => {
    expect(canLoadOlder({ ...page('a', '#foo'), loading: true })).toBe(false);
  });

  it('blocks once history runs out', () => {
    expect(canLoadOlder({ ...page('a', '#foo'), exhausted: true })).toBe(false);
  });

  it('blocks before the latest page has an oldest line', () => {
    expect(canLoadOlder({ ...page('a', '#foo'), oldestId: null })).toBe(false);
  });
});

describe('linesToStore', () => {
  const lines: Message[] = [{ id: 1, nick: 'a', text: 'hi', timestamp: new Date(0) }];

  it('stores the lines of the current page', () => {
    const p = page('a', '#foo');
    expect(linesToStore(new Map([['a:#foo', p]]), 'a:#foo', p, lines)).toBe(lines);
  });

  it('stores an empty page so the view can ask for the next one', () => {
    const p = page('a', '#foo');
    expect(linesToStore(new Map([['a:#foo', p]]), 'a:#foo', p, [])).toEqual([]);
  });

  it('drops the lines of a page replaced or removed meanwhile', () => {
    const p = page('a', '#foo');
    expect(linesToStore(new Map([['a:#foo', page('a', '#foo')]]), 'a:#foo', p, lines)).toBeNull();
    expect(linesToStore(new Map(), 'a:#foo', p, lines)).toBeNull();
  });
});
