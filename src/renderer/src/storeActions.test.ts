import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Channel, Server } from './types';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}
globalThis.localStorage = new MemoryStorage() as unknown as Storage;

let useStore: typeof import('./store').useStore;
let DEFAULT_KEYBINDINGS: typeof import('./store').DEFAULT_KEYBINDINGS;

beforeAll(async () => {
  ({ useStore, DEFAULT_KEYBINDINGS } = await import('./store'));
});

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
});

const server = (id: string): Server =>
  ({ id, name: id, initial: id[0], secure: false, host: id, port: 6667, autojoinChannels: [] }) as Server;
const log = (id: string): Channel => ({ id: `${id}:__log__`, name: 'Log', isLog: true });
const chan = (name: string): Channel => ({ id: `#${name}`, name, isLog: false });
const get = () => useStore.getState();

function withServer(id: string, ...channels: Channel[]) {
  get().addServer(server(id), log(id));
  for (const c of channels) get().addChannel(id, c);
}

describe('servers', () => {
  it('addServer registers the server with its log channel and an empty log', () => {
    withServer('a');
    expect(get().servers.map((s) => s.id)).toEqual(['a']);
    expect(get().channelMap.a).toEqual([log('a')]);
    expect(get().messageMap['a:__log__']).toEqual([]);
  });

  it('removeServer drops everything the server owned and keeps other servers intact', () => {
    withServer('a', chan('x'));
    withServer('b');
    get().setNick('a', 'me');
    get().setSaslCreds('a', 'u', 'p');
    get().setServerPassword('a', 'pw');
    get().setConnectionStatus('a', 'connected');
    get().addIgnore('a', 'troll');
    get().setSelfAway('a', true);
    get().setUsers('a:#x', [{ nick: 'n', privileges: [] }]);
    get().removeServer('a');
    const s = get();
    expect(s.servers.map((x) => x.id)).toEqual(['b']);
    expect(s.channelMap.a).toBeUndefined();
    expect(s.messageMap['a:#x']).toBeUndefined();
    expect(s.userMap['a:#x']).toBeUndefined();
    for (const map of [s.nickMap, s.saslMap, s.passwordMap, s.statusMap, s.ignoredNicks, s.selfAwayMap]) {
      expect(map.a).toBeUndefined();
    }
  });

  it('removing the selected server falls back to the first remaining one on its log', () => {
    withServer('a');
    withServer('b');
    get().selectServer('a');
    get().removeServer('a');
    expect(get().selectedServerId).toBe('b');
    expect(get().selectedChannelId).toBe('b:__log__');
  });

  it('removing the last server leaves nothing selected', () => {
    withServer('a');
    get().selectServer('a');
    get().removeServer('a');
    expect(get().selectedServerId).toBe('');
    expect(get().selectedChannelId).toBe('__log__');
  });

  it('removing a server that is not selected keeps the selection', () => {
    withServer('a');
    withServer('b');
    get().selectServer('a');
    get().removeServer('b');
    expect(get().selectedServerId).toBe('a');
  });

  it('addPreset ignores a preset it already has', () => {
    const before = get().presets.length;
    get().addPreset({ id: 'mine', name: 'Mine', host: 'h', port: 1, secure: true } as never);
    get().addPreset({ id: 'mine', name: 'Mine', host: 'h', port: 1, secure: true } as never);
    expect(get().presets).toHaveLength(before + 1);
  });
});

describe('channels', () => {
  it('addChannel adds once and creates its message list', () => {
    withServer('a');
    get().addChannel('a', chan('x'));
    get().addChannel('a', chan('x'));
    expect(get().channelMap.a.filter((c) => c.id === '#x')).toHaveLength(1);
    expect(get().messageMap['a:#x']).toEqual([]);
  });

  it('records the topic and who set it', () => {
    withServer('a', chan('x'));
    const when = new Date(5);
    get().setTopic('a', '#x', 'hello');
    get().setTopicWhoTime('a', '#x', 'mira', when);
    const c = get().channelMap.a.find((ch) => ch.id === '#x');
    expect(c).toMatchObject({ topic: 'hello', topicSetBy: 'mira', topicSetAt: when });
  });

  it('removeChannel drops its messages and users, and reselects the log if it was open', () => {
    withServer('a', chan('x'));
    get().selectServer('a');
    get().selectChannel('#x');
    get().setUsers('a:#x', [{ nick: 'n', privileges: [] }]);
    get().removeChannel('a', '#x');
    expect(get().channelMap.a.map((c) => c.id)).toEqual(['a:__log__']);
    expect(get().userMap['a:#x']).toBeUndefined();
    expect(get().selectedChannelId).toBe('a:__log__');
  });

  it('removeChannel keeps the selection when another channel was closed', () => {
    withServer('a', chan('x'), chan('y'));
    get().selectServer('a');
    get().selectChannel('#y');
    get().removeChannel('a', '#x');
    expect(get().selectedChannelId).toBe('#y');
  });

  it('appendMessage adds to the end of a channel', () => {
    const m = (id: number) => ({ id, nick: 'n', text: String(id), timestamp: new Date(id) });
    get().appendMessage('a:#x', m(1));
    get().appendMessage('a:#x', m(2));
    expect(get().messageMap['a:#x'].map((x) => x.id)).toEqual([1, 2]);
  });
});

describe('users', () => {
  const user = (nick: string, privileges: never[] = []) => ({ nick, privileges });

  it('addUser ignores a nick already listed', () => {
    get().addUser('a:#x', user('mira'));
    get().addUser('a:#x', user('mira'));
    expect(get().userMap['a:#x']).toHaveLength(1);
  });

  it('removeUser removes one nick', () => {
    get().setUsers('a:#x', [user('a'), user('b')]);
    get().removeUser('a:#x', 'a');
    expect(get().userMap['a:#x'].map((u) => u.nick)).toEqual(['b']);
  });

  it('applyModeChanges grants once, revokes, and leaves other nicks alone', () => {
    get().setUsers('a:#x', [user('mira'), user('tomas')]);
    get().applyModeChanges('a:#x', [
      { nick: 'mira', privilege: 'op', granted: true },
      { nick: 'mira', privilege: 'op', granted: true },
      { nick: 'mira', privilege: 'voice', granted: true },
    ]);
    expect(get().userMap['a:#x'][0].privileges).toEqual(['op', 'voice']);
    expect(get().userMap['a:#x'][1].privileges).toEqual([]);
    get().applyModeChanges('a:#x', [{ nick: 'mira', privilege: 'op', granted: false }]);
    expect(get().userMap['a:#x'][0].privileges).toEqual(['voice']);
  });
});

describe('selection and reading', () => {
  it('selectServer reopens the channel last used there, or the log when it is gone', () => {
    withServer('a', chan('x'));
    get().selectServer('a');
    get().selectChannel('#x');
    get().selectServer('a');
    expect(get().selectedChannelId).toBe('#x');
    get().removeChannel('a', '#x');
    get().selectServer('a');
    expect(get().selectedChannelId).toBe('a:__log__');
  });

  it('selecting a mentioned channel clears its mention', () => {
    withServer('a', chan('x'));
    get().selectServer('a');
    get().markMentioned('#x');
    expect(get().mentionedChannels['#x']).toBe(true);
    get().selectChannel('#x');
    expect(get().mentionedChannels['#x']).toBeUndefined();
  });

  it('markRead stamps the channel', () => {
    get().markRead('a:#x');
    expect(get().lastReadMap['a:#x']).toBeGreaterThan(0);
  });

  it('toggleMuteChannel mutes then unmutes', () => {
    get().toggleMuteChannel('#x');
    expect(get().mutedChannels['#x']).toBe(true);
    get().toggleMuteChannel('#x');
    expect(get().mutedChannels['#x']).toBeUndefined();
  });
});

describe('preferences', () => {
  it('each setter changes only its own preference', () => {
    get().setNotificationsEnabled(false);
    get().setSoundAlertsEnabled(false);
    get().setShowMembershipEvents(false);
    get().setTimestampFormat('24h');
    get().setMessageDensity('compact');
    get().setFontSize('large');
    get().setFontFamily('serif');
    get().setTheme('light');
    expect(get()).toMatchObject({
      notificationsEnabled: false,
      soundAlertsEnabled: false,
      showMembershipEvents: false,
      timestampFormat: '24h',
      messageDensity: 'compact',
      fontSize: 'large',
      fontFamily: 'serif',
      theme: 'light',
    });
  });

  it('rebinds one key without touching the others', () => {
    get().setKeybinding('closeChannel', 'Ctrl+K');
    expect(get().keybindings).toEqual({ ...DEFAULT_KEYBINDINGS, closeChannel: 'Ctrl+K' });
  });

  it('sets and removes aliases', () => {
    get().setAlias('j', '/join $1');
    expect(get().aliases).toEqual({ j: '/join $1' });
    get().removeAlias('j');
    expect(get().aliases).toEqual({});
  });
});

describe('ignore and trust lists', () => {
  it('ignores a nick once and can unignore it', () => {
    get().addIgnore('a', 'troll');
    get().addIgnore('a', 'troll');
    expect(get().ignoredNicks.a).toEqual(['troll']);
    get().removeIgnore('a', 'troll');
    expect(get().ignoredNicks.a).toEqual([]);
  });

  it('trusts a sender once, never trusts one with nothing to recognise, and untrusts', () => {
    const sender = { nick: 'bot', account: 'acct' };
    get().trustXdccSender('a', sender);
    get().trustXdccSender('a', { nick: 'renamed', account: 'ACCT' });
    get().trustXdccSender('a', { nick: 'anon' });
    expect(get().xdccTrusted.a).toEqual([sender]);
    get().untrustXdccSender('a', sender);
    expect(get().xdccTrusted.a).toEqual([]);
  });
});

describe('persistence: upgrading stored data', () => {
  it('drops live connection state from data saved by an older version', async () => {
    localStorage.setItem(
      'dolq',
      JSON.stringify({
        version: 0,
        state: { servers: [], channelMap: { s1: [{ id: '#a', name: 'a', isLog: false, joined: true }] } },
      }),
    );
    await useStore.persist.rehydrate();
    const channel = useStore.getState().channelMap.s1[0];
    expect(channel).toMatchObject({ id: '#a', name: 'a' });
    expect(channel.joined).toBeUndefined();
  });

  it('starts from defaults when the stored data is from a newer version', async () => {
    useStore.setState({ theme: 'light' });
    localStorage.setItem('dolq', JSON.stringify({ version: 999, state: { theme: 'light', servers: [{ id: 'x' }] } }));
    await useStore.persist.rehydrate();
    expect(useStore.getState().servers).toEqual([]);
  });
});
