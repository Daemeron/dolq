import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { Server } from './types';

function server(id: string): Server {
  return { id, name: id, initial: id[0], secure: false, host: id, port: 6667, autojoinChannels: [] };
}

// The default vitest environment (see vitest.workspace.mts's known gap - not
// auto-picked up by `vitest run`) is plain node, with no real localStorage -
// the store's persist middleware reads it once, at module-eval time, to set
// up its storage adapter. Stubbed in with a bare in-memory stand-in *before*
// store.ts is imported (a dynamic import, so this assignment - not a hoisted
// static import of store.ts itself - runs first).
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
globalThis.localStorage = new MemoryStorage() as unknown as Storage;

let useStore: typeof import('./store').useStore;
let scopeKey: typeof import('./store').scopeKey;

beforeAll(async () => {
  ({ useStore, scopeKey } = await import('./store'));
});

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
});

describe('scopeKey', () => {
  it('prefixes a bare channel/nick id with the owning server', () => {
    expect(scopeKey('server-a', '#linux')).toBe('server-a:#linux');
  });

  it('leaves an id that already carries a server-scoped prefix (log/DCC) untouched', () => {
    expect(scopeKey('server-a', 'server-a:__log__')).toBe('server-a:__log__');
    expect(scopeKey('server-a', 'dcc:some-uuid')).toBe('dcc:some-uuid');
  });
});

describe('store: same-named channels on different servers', () => {
  it('keeps messages and users separate, not merged into one shared entry', () => {
    const { addServer, addChannel, appendMessage, setUsers } = useStore.getState();

    addServer(server('server-a'), { id: 'server-a:__log__', name: 'Log', isLog: true });
    addServer(server('server-b'), { id: 'server-b:__log__', name: 'Log', isLog: true });
    addChannel('server-a', { id: '#linux', name: 'linux', isLog: false });
    addChannel('server-b', { id: '#linux', name: 'linux', isLog: false });

    appendMessage(scopeKey('server-a', '#linux'), { id: 1, nick: 'alice', text: 'hi from A', timestamp: new Date() });
    appendMessage(scopeKey('server-b', '#linux'), { id: 2, nick: 'bob', text: 'hi from B', timestamp: new Date() });
    setUsers(scopeKey('server-a', '#linux'), [{ nick: 'alice', privileges: [] }]);
    setUsers(scopeKey('server-b', '#linux'), [{ nick: 'bob', privileges: [] }]);

    const { messageMap, userMap } = useStore.getState();
    expect(messageMap[scopeKey('server-a', '#linux')]).toEqual([
      { id: 1, nick: 'alice', text: 'hi from A', timestamp: expect.any(Date) },
    ]);
    expect(messageMap[scopeKey('server-b', '#linux')]).toEqual([
      { id: 2, nick: 'bob', text: 'hi from B', timestamp: expect.any(Date) },
    ]);
    expect(userMap[scopeKey('server-a', '#linux')]).toEqual([{ nick: 'alice', privileges: [] }]);
    expect(userMap[scopeKey('server-b', '#linux')]).toEqual([{ nick: 'bob', privileges: [] }]);
  });
});
