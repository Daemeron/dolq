import { describe, expect, it } from 'vitest';
import type { Channel } from '../types';
import { dropServerPages, type HistoryPage, pagesToReload } from './historyPages';

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
