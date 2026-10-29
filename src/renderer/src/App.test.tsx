import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type IrcEvent, RELEASES_URL, type UpdateStatus } from '../../shared/ipc';
import App from './App';
import { useStore } from './store';
import type { Channel, Server } from './types';

// Every interaction runs inside an async act, so what it sets off (history loads, sends) lands before the next line.
type Interaction = (target: Document | Element | Window, init?: object) => Promise<void>;
const fire = Object.fromEntries(
  (['click', 'change', 'contextMenu', 'keyDown', 'scroll', 'submit'] as const).map((name) => [
    name,
    async (target, init) => {
      await act(async () => {
        fireEvent[name](target, init);
      });
    },
  ]),
) as Record<'click' | 'change' | 'contextMenu' | 'keyDown' | 'scroll' | 'submit', Interaction>;

type Callbacks = Record<string, ((...args: unknown[]) => void)[]>;

// A stand-in for the preload bridge: on* methods remember their callbacks so a test can push events
// in, everything else is a spy that resolves to a sensible default.
function installIrc(overrides: Record<string, unknown> = {}) {
  const callbacks: Callbacks = {};
  const defaults: Record<string, unknown> = {
    getSettings: { retentionDays: 0 },
    getStatus: 'connected',
    getJoinedChannels: ['#dolq', '#other'],
    getHistory: [],
    search: [],
    secretsAvailable: true,
    sendLine: undefined,
    xdccAccept: 'xfer-1',
    dccAccept: 'dcc:1',
    dccOffer: 'dcc:2',
    ...overrides,
  };
  const spies = new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
    get: (target, name: string) => {
      target[name] ??= vi.fn(async () => defaults[name]);
      return target[name];
    },
  });
  const irc = new Proxy(
    {},
    {
      get(_t, name: string) {
        if (name.startsWith('on')) {
          return (cb: (...args: unknown[]) => void) => {
            callbacks[name] = [...(callbacks[name] ?? []), cb];
            return () => {
              callbacks[name] = callbacks[name].filter((c) => c !== cb);
            };
          };
        }
        return spies[name];
      },
    },
  );
  (window as unknown as { irc: unknown }).irc = irc;
  return {
    spies,
    emit: (name: string, ...args: unknown[]) =>
      act(() => {
        for (const cb of [...(callbacks[name] ?? [])]) cb(...args);
      }),
    event: (serverId: string, event: IrcEvent) =>
      act(async () => {
        for (const cb of [...(callbacks.onEvent ?? [])]) cb(serverId, event);
      }),
  };
}

const server: Server = { id: 's1', name: 'Libera', initial: 'L', secure: true, host: 'irc.libera.chat', port: 6697 };
const log: Channel = { id: '__log__', name: 'Log', isLog: true, joined: true };
const dolq: Channel = { id: '#dolq', name: 'dolq', isLog: false, joined: true };
const other: Channel = { id: '#other', name: 'other', isLog: false, joined: true };

function seed(extra: Record<string, unknown> = {}) {
  useStore.setState(
    {
      ...useStore.getInitialState(),
      servers: [server],
      channelMap: { s1: [log, dolq, other] },
      messageMap: { 's1:__log__': [], 's1:#dolq': [], 's1:#other': [] },
      userMap: { 's1:#dolq': [{ nick: 'mira', privileges: ['op'] }] },
      nickMap: { s1: 'me' },
      selectedServerId: 's1',
      selectedChannelId: '#dolq',
      statusMap: { s1: 'connected' },
      ...extra,
    },
    true,
  );
}

// jsdom has no layout; give the virtualized lists room so their rows render.
function withLayout() {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 800,
    height: 800,
    top: 0,
    left: 0,
    right: 800,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

async function mount(overrides: Record<string, unknown> = {}) {
  const irc = installIrc(overrides);
  await act(async () => {
    render(<App />);
  });
  await waitFor(() => expect(irc.spies.getSettings).toHaveBeenCalled());
  return irc;
}

beforeEach(() => {
  withLayout();
  seed();
});
afterEach(async () => {
  // Let what the test left in flight (history loads, sends) land inside act before it is torn down.
  await act(async () => {});
  cleanup();
  vi.restoreAllMocks();
});

const composer = () => screen.getByPlaceholderText('Message #dolq') as HTMLInputElement;
async function typeAndSend(text: string) {
  await fire.change(composer(), { target: { value: text } });
  await fire.submit(composer().closest('form') as HTMLFormElement);
}

describe('App: layout', () => {
  it('shows the selected server, its channels and the channel members', async () => {
    await mount();
    expect(screen.getAllByText('Libera').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: '#dolq' })).toBeTruthy();
    expect(screen.getByText('other')).toBeTruthy();
    expect(await screen.findByText('mira')).toBeTruthy();
    expect(screen.getByText(/^\d+ online$/)).toBeTruthy();
  });

  it('hides the members panel from the toolbar', async () => {
    await mount();
    await screen.findByText('mira');
    await fire.click(screen.getByRole('button', { name: 'Members' }));
    expect(screen.queryByText('mira')).toBeNull();
  });

  it('switches channels from the sidebar', async () => {
    await mount();
    await fire.click(screen.getByText('other'));
    expect(screen.getByRole('heading', { name: '#other' })).toBeTruthy();
  });

  it('lists a server whose status the backend reports as connected', async () => {
    useStore.setState({ statusMap: {} });
    const irc = await mount();
    await waitFor(() => expect(irc.spies.getStatus).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(useStore.getState().statusMap.s1).toBe('connected'));
  });

  it('follows status changes pushed by the backend', async () => {
    const irc = await mount();
    irc.emit('onStatus', 's1', 'disconnected');
    expect(screen.getAllByLabelText('Disconnected').length).toBeGreaterThan(0);
    irc.emit('onStatus', 's1', 'connected');
    expect(screen.getAllByLabelText('Connected').length).toBeGreaterThan(0);
  });
});

describe('App: incoming messages', () => {
  it('shows a channel message', async () => {
    const irc = await mount();
    await irc.event('s1', { type: 'PRIVMSG', nick: 'mira', target: '#dolq', text: 'hello there' });
    expect(await screen.findByText('hello there')).toBeTruthy();
  });

  it('ignores messages from ignored nicks', async () => {
    seed({ ignoredNicks: { s1: ['troll'] } });
    const irc = await mount();
    await irc.event('s1', { type: 'PRIVMSG', nick: 'troll', target: '#dolq', text: 'buy my stuff' });
    expect(screen.queryByText('buy my stuff')).toBeNull();
  });

  it('opens a direct message for a private message', async () => {
    const irc = await mount();
    await irc.event('s1', { type: 'PRIVMSG', nick: 'kestrel', target: 'me', text: 'psst' });
    expect(await screen.findByText('Direct messages')).toBeTruthy();
    expect(screen.getByText('kestrel')).toBeTruthy();
  });

  it('flags a mention in another channel, alerts and updates the badge', async () => {
    const irc = await mount();
    await irc.event('s1', { type: 'PRIVMSG', nick: 'mira', target: '#other', text: 'me: ping' });
    expect(useStore.getState().mentionedChannels['#other']).toBe(true);
    expect(irc.spies.playAlertSound).toHaveBeenCalled();
    await waitFor(() => expect(irc.spies.setBadgeCount).toHaveBeenLastCalledWith(1));
    // the toolbar offers a way to jump there
    await fire.click(screen.getByRole('button', { name: 'Mentions' }));
    await fire.click(screen.getByText('#other'));
    expect(screen.getByRole('heading', { name: '#other' })).toBeTruthy();
    expect(useStore.getState().mentionedChannels['#other']).toBeUndefined();
  });

  it('does not alert for a mention in a muted channel', async () => {
    seed({ mutedChannels: { '#other': true } });
    const irc = await mount();
    await irc.event('s1', { type: 'PRIVMSG', nick: 'mira', target: '#other', text: 'me: ping' });
    expect(irc.spies.playAlertSound).not.toHaveBeenCalled();
  });

  it('shows actions, notices and system lines in the channel', async () => {
    const irc = await mount();
    await irc.event('s1', { type: 'ACTION', nick: 'mira', target: '#dolq', text: 'waves' });
    await irc.event('s1', { type: 'NOTICE', nick: 'ChanServ', target: '#dolq', text: 'welcome all' });
    await irc.event('s1', { type: 'JOIN', nick: 'tomas', channel: '#dolq' });
    expect(await screen.findByText('waves')).toBeTruthy();
    expect(screen.getByText('welcome all')).toBeTruthy();
    expect((await screen.findAllByText(/tomas/)).length).toBeGreaterThan(0);
  });

  it('shows pack announcements', async () => {
    const irc = await mount();
    await irc.event('s1', {
      type: 'XDCCPACK',
      nick: 'bot',
      target: '#dolq',
      number: 7,
      gets: 3,
      size: '1G',
      filename: 'f.iso',
    });
    expect(await screen.findByText(/#7 · 3x sent/)).toBeTruthy();
  });
});

describe('App: channel membership', () => {
  it('adds a channel we join and selects it', async () => {
    const irc = await mount();
    await irc.event('s1', { type: 'JOIN', nick: 'me', channel: '#new' });
    expect(await screen.findByRole('heading', { name: '#new' })).toBeTruthy();
  });

  it('tracks other users coming and going', async () => {
    const irc = await mount();
    await irc.event('s1', { type: 'JOIN', nick: 'tomas', channel: '#dolq' });
    expect(await screen.findByText('tomas', { selector: 'span.flex-1' })).toBeTruthy();
    await irc.event('s1', { type: 'PART', nick: 'tomas', channel: '#dolq' });
    await waitFor(() => expect(screen.queryByText('tomas', { selector: 'span.flex-1' })).toBeNull());
  });

  it('removes a quitter from every channel, renames a nick, applies modes and a names list', async () => {
    const irc = await mount();
    await irc.event('s1', {
      type: 'names',
      channel: '#dolq',
      users: [
        { nick: 'a', privileges: [] },
        { nick: 'b', privileges: [] },
      ],
    });
    expect(await screen.findByText('a', { selector: 'span.flex-1' })).toBeTruthy();
    await irc.event('s1', { type: 'NICK', oldNick: 'a', newNick: 'a2' });
    expect(await screen.findByText('a2', { selector: 'span.flex-1' })).toBeTruthy();
    await irc.event('s1', { type: 'MODE', channel: '#dolq', changes: [{ nick: 'b', privilege: 'op', granted: true }] });
    expect(await screen.findByText('Operators · 1')).toBeTruthy();
    await irc.event('s1', { type: 'QUIT', nick: 'b' });
    await waitFor(() => expect(screen.queryByText('b', { selector: 'span.flex-1' })).toBeNull());
  });

  it('records topics and renames our own nick', async () => {
    const irc = await mount();
    await irc.event('s1', { type: 'TOPIC', channel: '#dolq', topic: 'Release day', nick: 'mira' });
    expect(await screen.findByText('Release day')).toBeTruthy();
    await irc.event('s1', { type: 'TOPICWHOTIME', channel: '#dolq', nick: 'mira', setAt: 1000 });
    await irc.event('s1', { type: 'NICK', oldNick: 'me', newNick: 'me2' });
    expect(useStore.getState().nickMap.s1).toBe('me2');
  });

  it('marks us as having left after a part or a kick', async () => {
    const irc = await mount();
    await irc.event('s1', { type: 'PART', nick: 'me', channel: '#dolq' });
    expect(useStore.getState().channelMap.s1.find((c) => c.id === '#dolq')?.joined).toBe(false);
    await irc.event('s1', { type: 'JOIN', nick: 'me', channel: '#dolq' });
    await irc.event('s1', { type: 'KICK', by: 'op', nick: 'me', channel: '#dolq' });
    expect(useStore.getState().channelMap.s1.find((c) => c.id === '#dolq')?.joined).toBe(false);
  });

  it('adopts the nick the server welcomes us with and joins the autojoin channels', async () => {
    seed({ servers: [{ ...server, autojoinChannels: ['#a', '#b'] }] });
    const irc = await mount();
    await irc.event('s1', { type: 'WELCOME', nick: 'me_' });
    expect(useStore.getState().nickMap.s1).toBe('me_');
    expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'JOIN #a');
    expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'JOIN #b');
  });

  it('explains a taken nickname in the log', async () => {
    const irc = await mount();
    await irc.event('s1', { type: 'NICKINUSE', nick: 'me', retrying: 'me_' });
    await fire.click(screen.getByText('Server log'));
    expect(await screen.findByText(/already in use - trying "me_"/)).toBeTruthy();
  });
});

describe('App: sending', () => {
  it('sends a channel message and shows it', async () => {
    const irc = await mount();
    await typeAndSend('hello world');
    await waitFor(() => expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'PRIVMSG #dolq :hello world'));
    expect(await screen.findByText('hello world')).toBeTruthy();
  });

  it('sends /me as a CTCP action', async () => {
    const irc = await mount();
    await typeAndSend('/me waves');
    await waitFor(() => expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'PRIVMSG #dolq :\x01ACTION waves\x01'));
  });

  it('runs /join, /away and /msg', async () => {
    const irc = await mount();
    await typeAndSend('/join #new key');
    await waitFor(() => expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'JOIN #new key'));
    await typeAndSend('/away lunch');
    await waitFor(() => expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'AWAY :lunch'));
    await typeAndSend('/msg mira hi there');
    await waitFor(() => expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'PRIVMSG mira :hi there'));
    expect(await screen.findByText('mira', { selector: 'span.flex-1' })).toBeTruthy();
  });

  it('expands aliases', async () => {
    seed({ aliases: { hi: '/me greets $1' } });
    const irc = await mount();
    await typeAndSend('/hi everyone');
    await waitFor(() =>
      expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'PRIVMSG #dolq :\x01ACTION greets everyone\x01'),
    );
  });

  it('defines and removes aliases from the input', async () => {
    await mount();
    await typeAndSend('/alias j /join $1');
    await waitFor(() => expect(useStore.getState().aliases.j).toBe('/join $1'));
    await typeAndSend('/unalias j');
    await waitFor(() => expect(useStore.getState().aliases.j).toBeUndefined());
  });

  it('tells the user about an unknown command instead of sending it', async () => {
    const irc = await mount();
    await typeAndSend('/frobnicate now');
    expect(await screen.findByText(/Unknown or incomplete command: \/frobnicate/)).toBeTruthy();
    expect(irc.spies.sendLine).not.toHaveBeenCalledWith('s1', expect.stringContaining('frobnicate'));
  });

  it('sends a // message as literal text', async () => {
    const irc = await mount();
    await typeAndSend('//shrug');
    await waitFor(() => expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'PRIVMSG #dolq :/shrug'));
  });

  it('looks someone up with /whois', async () => {
    const irc = await mount();
    await typeAndSend('/whois mira');
    await waitFor(() => expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'WHOIS mira'));
    expect(await screen.findByText('Looking up...')).toBeTruthy();
    await irc.event('s1', { type: 'whois', nick: 'mira', user: 'mira', host: 'example.org' });
    expect(await screen.findByText('mira@example.org')).toBeTruthy();
    await fire.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('mira@example.org')).toBeNull();
  });

  it('connects and disconnects with /connect and /disconnect', async () => {
    const irc = await mount();
    await typeAndSend('/disconnect');
    await waitFor(() => expect(irc.spies.disconnect).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(useStore.getState().statusMap.s1).toBe('disconnected'));
    await typeAndSend('/connect');
    await waitFor(() => expect(irc.spies.connect).toHaveBeenCalled());
  });
});

describe('App: updates', () => {
  const found = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
    state: 'available',
    version: '0.8.0',
    canInstall: true,
    ...over,
  });

  it('shows nothing until a newer version is reported, then follows it from found to downloaded', async () => {
    const irc = await mount();
    expect(screen.queryByRole('button', { name: /update/i })).toBeNull();
    await irc.emit('onUpdateStatus', found());
    expect(screen.getByRole('button', { name: 'Update to 0.8.0' })).toBeTruthy();
    await irc.emit('onUpdateStatus', found({ state: 'downloading' }));
    expect(screen.getByRole('button', { name: 'Downloading 0.8.0…' })).toBeTruthy();
    await irc.emit('onUpdateStatus', found({ state: 'downloaded' }));
    expect(screen.getByRole('button', { name: 'Restart to update' })).toBeTruthy();
  });

  it('picks up a version that was found before the window opened', async () => {
    await mount({ getUpdateStatus: found({ state: 'downloaded' }) });
    expect(await screen.findByRole('button', { name: 'Restart to update' })).toBeTruthy();
  });

  it('downloads when the notice is clicked where Dolq can install', async () => {
    const irc = await mount();
    await irc.emit('onUpdateStatus', found());
    await fire.click(screen.getByRole('button', { name: 'Update to 0.8.0' }));
    expect(irc.spies.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(irc.spies.openExternal).not.toHaveBeenCalled();
  });

  it('opens the release page when the notice is clicked where Dolq cannot install', async () => {
    const irc = await mount();
    await irc.emit('onUpdateStatus', found({ canInstall: false }));
    await fire.click(screen.getByRole('button', { name: 'Update to 0.8.0' }));
    expect(irc.spies.openExternal).toHaveBeenCalledWith(RELEASES_URL);
    expect(irc.spies.downloadUpdate).not.toHaveBeenCalled();
  });

  it('restarts into a downloaded version', async () => {
    const irc = await mount();
    await irc.emit('onUpdateStatus', found({ state: 'downloaded' }));
    await fire.click(screen.getByRole('button', { name: 'Restart to update' }));
    expect(irc.spies.installUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('App: dialogs', () => {
  it('opens and closes preferences from the sidebar and Escape', async () => {
    await mount();
    await fire.click(screen.getByRole('button', { name: 'Preferences' }));
    expect(screen.getByRole('dialog', { name: 'Preferences' })).toBeTruthy();
    await fire.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Preferences' })).toBeNull();
  });

  it('opens preferences when the menu asks for it, and saves them', async () => {
    const irc = await mount();
    irc.emit('onOpenPreferences');
    await fire.submit(screen.getByRole('button', { name: 'Save' }).closest('form') as HTMLFormElement);
    await waitFor(() => expect(irc.spies.setSettings).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Preferences' })).toBeNull());
  });

  it('opens the add-server dialog, prefilled from an irc:// link', async () => {
    const irc = await mount();
    irc.emit('onOpenIrcUrl', { host: 'irc.example.org', port: 6667, secure: false, channel: '#hi' });
    expect(await screen.findByRole('dialog', { name: 'Add a server' })).toBeTruthy();
    expect((screen.getByPlaceholderText('irc.libera.chat') as HTMLInputElement).value).toBe('irc.example.org');
  });

  it('adds a server and connects to it', async () => {
    const irc = await mount();
    await fire.click(screen.getByRole('button', { name: 'Add server' }));
    await fire.change(screen.getByPlaceholderText('irc.libera.chat'), { target: { value: 'irc.example.org' } });
    await fire.change(screen.getByPlaceholderText('yournick'), { target: { value: 'newme' } });
    await fire.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(irc.spies.connect).toHaveBeenCalled());
    expect(useStore.getState().servers).toHaveLength(2);
  });

  it('opens the server editor from its menu', async () => {
    await mount();
    await fire.contextMenu(screen.getByRole('button', { name: 'Libera' }));
    await fire.click(screen.getByText('Edit Server…'));
    expect(await screen.findByRole('dialog', { name: 'Edit server' })).toBeTruthy();
    await fire.change(screen.getByPlaceholderText('My Server'), { target: { value: 'Libera 2' } });
    await fire.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(useStore.getState().servers[0].name).toBe('Libera 2'));
  });

  it('keeps the icon letters and colour picked in the server editor', async () => {
    await mount();
    await fire.contextMenu(screen.getByRole('button', { name: 'Libera' }));
    await fire.click(screen.getByText('Edit Server…'));
    await screen.findByRole('dialog', { name: 'Edit server' });
    await fire.change(screen.getByLabelText('Icon letters'), { target: { value: ' lib ' } });
    await fire.click(screen.getAllByRole('button', { name: /^Colour / })[2]);
    await fire.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(useStore.getState().servers[0].initials).toBe('lib'));
    expect(useStore.getState().servers[0].color).toBe('var(--dolq-nick-3)');
    expect(screen.getByRole('button', { name: 'Libera' })).toHaveTextContent('lib');
  });

  it('removes a server after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const irc = await mount();
    await fire.contextMenu(screen.getByRole('button', { name: 'Libera' }));
    await fire.click(screen.getByText('Remove Server'));
    await waitFor(() => expect(useStore.getState().servers).toHaveLength(0));
    expect(irc.spies.forgetSecrets).toHaveBeenCalledWith('s1');
  });

  it('keeps the server when removal is not confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await mount();
    await fire.contextMenu(screen.getByRole('button', { name: 'Libera' }));
    await fire.click(screen.getByText('Remove Server'));
    expect(useStore.getState().servers).toHaveLength(1);
  });

  it('hands the toolbar colours to the window controls and marks the platform', async () => {
    document.documentElement.style.setProperty('--dolq-bg-panel-alt', ' #262624 ');
    document.documentElement.style.setProperty('--dolq-text', '#faf9f5');
    const irc = await mount();
    expect(irc.spies.setTitleBar).toHaveBeenCalledWith('#262624', '#faf9f5');
    expect(document.documentElement.dataset.platform).toBe('other');
    document.documentElement.style.removeProperty('--dolq-bg-panel-alt');
    document.documentElement.style.removeProperty('--dolq-text');
  });

  it('survives a preload that has no setTitleBar', async () => {
    document.documentElement.style.setProperty('--dolq-bg-panel-alt', '#262624');
    document.documentElement.style.setProperty('--dolq-text', '#faf9f5');
    await mount();
    const real = window.irc;
    (window as unknown as { irc: unknown }).irc = new Proxy(real, {
      get: (target, name: string) => (name === 'setTitleBar' ? undefined : Reflect.get(target, name)),
    });
    act(() => useStore.getState().setTheme('light'));
    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(screen.getByRole('button', { name: 'Libera' })).toBeTruthy();
    document.documentElement.style.removeProperty('--dolq-bg-panel-alt');
    document.documentElement.style.removeProperty('--dolq-text');
  });

  it('opens the dashboard from the rail and returns to the chat from a channel chip', async () => {
    await mount();
    await fire.click(screen.getByRole('button', { name: 'Dashboard' }));
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.queryByPlaceholderText('Message #dolq')).toBeNull();
    await fire.click(within(screen.getByRole('region', { name: 'Libera' })).getByRole('button', { name: '#other' }));
    expect(screen.getByRole('heading', { name: '#other' })).toBeTruthy();
    expect(useStore.getState().selectedChannelId).toBe('#other');
  });

  it('hides the channel list and the user panel on the dashboard', async () => {
    await mount();
    expect(screen.getByText('Channels')).toBeTruthy();
    await fire.click(screen.getByRole('button', { name: 'Dashboard' }));
    expect(screen.queryByText('Channels')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Away' })).toBeNull();
    // the rail's server entry comes first, before the server's card on the dashboard
    await fire.click(screen.getAllByRole('button', { name: 'Libera' })[0]);
    expect(screen.getByText('Channels')).toBeTruthy();
  });

  it('titles the strip with where you are, and walks back and forward through places visited', async () => {
    await mount();
    expect(screen.getByRole('banner')).toHaveTextContent('#dolq · Libera');
    expect(screen.getByRole('button', { name: 'Back' }).parentElement).toHaveClass('pointer-events-none');
    await fire.click(screen.getByRole('button', { name: 'Dashboard' }));
    expect(screen.getByRole('banner')).toHaveTextContent('Dashboard');
    await fire.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('banner')).toHaveTextContent('#dolq · Libera');
    expect(screen.getByRole('heading', { name: '#dolq' })).toBeTruthy();
    await fire.click(screen.getByRole('button', { name: 'Forward' }));
    expect(screen.getByRole('banner')).toHaveTextContent('Dashboard');
    await fire.click(screen.getByRole('button', { name: 'Back' }));
    await fire.click(screen.getByText('other'));
    expect(screen.getByRole('banner')).toHaveTextContent('#other · Libera');
    await fire.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('banner')).toHaveTextContent('#dolq · Libera');
  });

  it('shows the latency the backend reports on the dashboard', async () => {
    const irc = await mount();
    await irc.event('s1', { type: 'LATENCY', ms: 42 });
    await irc.event('s1', { type: 'LATENCY', ms: 58 });
    expect(useStore.getState().latencyMap.s1.map((x) => x.ms)).toEqual([42, 58]);
    await fire.click(screen.getByRole('button', { name: 'Dashboard' }));
    expect(screen.getByText('58 ms')).toBeTruthy();
    expect(screen.getByText('min 42 · avg 50 · max 58 ms')).toBeTruthy();
  });

  it('sets and clears away on every connected server from the title strip', async () => {
    useStore.setState({
      servers: [server, { ...server, id: 's2', name: 'Rizon' }],
      statusMap: { s1: 'connected', s2: 'connected', s3: 'disconnected' },
    });
    const irc = await mount();
    await fire.click(screen.getByRole('button', { name: 'Away on all servers' }));
    expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'AWAY :Away');
    expect(irc.spies.sendLine).toHaveBeenCalledWith('s2', 'AWAY :Away');
    await irc.event('s1', { type: 'SELFAWAY', away: true });
    await irc.event('s2', { type: 'SELFAWAY', away: true });
    irc.spies.sendLine.mockClear();
    await fire.click(screen.getByRole('button', { name: 'Back from away on all servers' }));
    expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'AWAY');
    expect(irc.spies.sendLine).toHaveBeenCalledWith('s2', 'AWAY');
  });

  it('searches everywhere from the title strip, and in the channel from the toolbar', async () => {
    await mount();
    await fire.click(screen.getByRole('button', { name: 'Search everywhere' }));
    expect(screen.getByRole('radio', { name: 'Everywhere' })).toHaveAttribute('aria-checked', 'true');
    await fire.keyDown(window, { key: 'Escape' });
    cleanup();
    await mount();
    await fire.click(screen.getByRole('button', { name: 'Search history' }));
    expect(screen.getByRole('radio', { name: 'This channel' })).toHaveAttribute('aria-checked', 'true');
  });

  it('opens search from the toolbar', async () => {
    await mount();
    await fire.click(screen.getByRole('button', { name: 'Search history' }));
    expect(screen.getByText('Search History')).toBeTruthy();
  });
});

describe('App: prompts from the network', () => {
  it('identifies with NickServ when asked to', async () => {
    const irc = await mount();
    await irc.event('s1', {
      type: 'NOTICE',
      nick: 'NickServ',
      target: 'me',
      text: 'This nickname is registered. Please choose a different nickname, or identify via /msg NickServ IDENTIFY <password>',
    });
    await fire.change(await screen.findByPlaceholderText('Password'), { target: { value: 'pw' } });
    await fire.click(screen.getByRole('button', { name: 'Identify' }));
    await waitFor(() => expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'PRIVMSG NickServ :identify pw'));
  });

  it('accepts a DCC chat offer', async () => {
    const irc = await mount();
    await irc.event('s1', { type: 'DCCCHATOFFER', nick: 'kestrel', ip: '1.2.3.4', port: 5000 });
    expect(await screen.findByText('DCC chat request')).toBeTruthy();
    await fire.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(irc.spies.dccAccept).toHaveBeenCalledWith('1.2.3.4', 5000));
    expect((await screen.findAllByText('kestrel')).length).toBeGreaterThan(0);
  });

  it('declines a DCC chat offer', async () => {
    const irc = await mount();
    await irc.event('s1', { type: 'DCCCHATOFFER', nick: 'kestrel', ip: '1.2.3.4', port: 5000 });
    await fire.click(await screen.findByRole('button', { name: 'Decline' }));
    expect(irc.spies.dccAccept).not.toHaveBeenCalled();
    expect(screen.queryByText('DCC chat request')).toBeNull();
  });

  const offer: IrcEvent = {
    type: 'XDCCSENDOFFER',
    nick: 'bot',
    filename: 'f.iso',
    ip: '1.2.3.4',
    port: 5000,
    size: 2048,
    host: 'bot.example',
  };

  it('asks before a file offer, starts the download and shows its progress', async () => {
    const irc = await mount();
    await irc.event('s1', offer);
    expect(await screen.findByText('File offer')).toBeTruthy();
    await fire.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(irc.spies.xdccAccept).toHaveBeenCalledWith('s1', 'bot', '1.2.3.4', 5000, 'f.iso', 2048, undefined),
    );
    await fire.click(await screen.findByRole('button', { name: 'Transfers' }));
    expect(await screen.findByText('f.iso')).toBeTruthy();
    await irc.event('xfer-1', { type: 'XDCCTRANSFER', received: 1024, total: 2048, path: '/dl/f.iso' });
    expect(await screen.findByText(/50%/)).toBeTruthy();
    await irc.event('xfer-1', { type: 'XDCCTRANSFER', received: 2048, total: 2048, path: '/dl/f.iso', done: true });
    expect(await screen.findByText('Completed · 2.0 KB')).toBeTruthy();
    await fire.click(screen.getByRole('button', { name: 'Show in folder' }));
    expect(irc.spies.showInFolder).toHaveBeenCalledWith('/dl/f.iso');
  });

  it('trusts a sender for the session and skips the prompt the next time', async () => {
    const irc = await mount();
    await irc.event('s1', offer);
    await fire.click(await screen.findByRole('button', { name: 'Choose how to accept' }));
    await fire.click(screen.getByText(/for this session/));
    await fire.click(screen.getByRole('button', { name: 'Accept for session' }));
    await waitFor(() => expect(irc.spies.xdccAccept).toHaveBeenCalledTimes(1));
    await irc.event('s1', offer);
    await waitFor(() => expect(irc.spies.xdccAccept).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('File offer')).toBeNull();
  });

  it('remembers a sender permanently when asked', async () => {
    const irc = await mount();
    await irc.event('s1', offer);
    await fire.click(await screen.findByRole('button', { name: 'Choose how to accept' }));
    await fire.click(screen.getByText(/Always accept from/));
    await fire.click(screen.getByRole('button', { name: 'Always accept' }));
    await waitFor(() => expect(useStore.getState().xdccTrusted.s1).toHaveLength(1));
    expect(irc.spies.xdccAccept).toHaveBeenCalled();
  });

  it('declines a file offer', async () => {
    const irc = await mount();
    await irc.event('s1', offer);
    await fire.click(await screen.findByRole('button', { name: 'Decline' }));
    expect(irc.spies.xdccAccept).not.toHaveBeenCalled();
    expect(screen.queryByText('File offer')).toBeNull();
  });

  it('reports a failed download in the transfer card', async () => {
    const irc = await mount();
    await irc.event('s1', offer);
    await fire.click(await screen.findByRole('button', { name: 'Accept' }));
    await fire.click(await screen.findByRole('button', { name: 'Transfers' }));
    await screen.findByText('f.iso');
    await irc.event('xfer-1', { type: 'XDCCTRANSFER', received: 0, total: 2048, path: '', error: 'connection reset' });
    expect(await screen.findByText(/Failed: connection reset/)).toBeTruthy();
  });

  it('opens the transfers dialog from the toolbar and closes it again', async () => {
    const irc = await mount();
    await irc.event('s1', offer);
    await fire.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(screen.queryByRole('dialog', { name: 'Transfers' })).toBeNull();
    await fire.click(screen.getByRole('button', { name: 'Transfers' }));
    expect(await screen.findByText('f.iso')).toBeTruthy();
    await fire.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Transfers' })).toBeNull();
    await fire.click(screen.getByRole('button', { name: 'Transfers' }));
    await fire.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Transfers' })).toBeNull();
  });
});

describe('App: keyboard shortcuts', () => {
  it('moves between channels and mutes with the configured keys', async () => {
    await mount();
    await fire.keyDown(window, { key: 'ArrowDown', altKey: true });
    expect(screen.getByRole('heading', { name: '#other' })).toBeTruthy();
    await fire.keyDown(window, { key: 'ArrowUp', altKey: true });
    expect(screen.getByRole('heading', { name: '#dolq' })).toBeTruthy();
    await fire.keyDown(window, { key: 'm', altKey: true });
    expect(useStore.getState().mutedChannels['#dolq']).toBe(true);
  });

  it('leaves the current channel with the close shortcut', async () => {
    const irc = await mount();
    await fire.keyDown(window, { key: 'w', altKey: true });
    await waitFor(() => expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'PART #dolq'));
  });

  it('opens the search with its shortcut', async () => {
    await mount();
    expect(screen.queryByRole('dialog', { name: 'Search History' })).toBeNull();
    await fire.keyDown(window, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Search History' })).toBeTruthy();
  });
});

describe('App: saved keybindings', () => {
  it('keeps the default for a shortcut added after the bindings were saved', async () => {
    localStorage.setItem('dolq', JSON.stringify({ state: { keybindings: { nextChannel: 'Alt+J' } }, version: 1 }));
    await useStore.persist.rehydrate();
    expect(useStore.getState().keybindings).toMatchObject({ nextChannel: 'Alt+J', openSearch: 'Ctrl+K' });
    localStorage.clear();
  });
});

describe('App: first run', () => {
  const noServers = { servers: [], channelMap: {}, messageMap: {}, userMap: {}, selectedServerId: '' };

  it('welcomes you instead of showing an empty chat', async () => {
    seed(noServers);
    await mount();
    expect(screen.getByRole('heading', { name: 'Welcome to Dolq' })).toBeTruthy();
    expect(screen.queryByText('Channels')).toBeNull();
  });

  it('starts the add-server dialog on the network that was picked', async () => {
    seed(noServers);
    await mount();
    await fire.click(screen.getByRole('button', { name: /OFTC/ }));
    const network = (await screen.findByLabelText('Network')) as HTMLSelectElement;
    expect(network.value).toBe('irc.oftc.net:6697');
    expect((screen.getByPlaceholderText('irc.libera.chat') as HTMLInputElement).value).toBe('irc.oftc.net');
  });

  it('opens the backend settings to pair with a remote backend', async () => {
    seed(noServers);
    await mount();
    await fire.click(screen.getByRole('button', { name: 'Pair with a remote backend' }));
    const tab = await screen.findByRole('tab', { name: 'Backend' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });
});

describe('App: themes and preferences', () => {
  it('applies the theme and font choices to the document', async () => {
    useStore.setState({ theme: 'light', fontFamily: 'monospace' });
    await mount();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--dolq-font-family')).toContain('JetBrains Mono');
    act(() => useStore.setState({ theme: 'dark' }));
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('follows the system colour scheme when the theme is System, including when it changes', async () => {
    const original = window.matchMedia;
    let onChange: () => void = () => {};
    let light = true;
    window.matchMedia = (() => ({
      get matches() {
        return light;
      },
      addEventListener: (_: string, cb: () => void) => {
        onChange = cb;
      },
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      useStore.setState({ theme: 'system' });
      await mount();
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      light = false;
      act(() => onChange());
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });

  it('counts a highlight word as a mention', async () => {
    useStore.setState({ highlightWords: ['release'] });
    const irc = await mount();
    await irc.event('s1', {
      type: 'PRIVMSG',
      nick: 'mira',
      target: '#other',
      text: 'cutting the release now',
    } as IrcEvent);
    await waitFor(() => expect(useStore.getState().mentionedChannels['#other']).toBe(true));
  });
});

const entry = (id: number, extra: Record<string, unknown>) => ({
  id,
  serverId: 's1',
  channel: '#dolq',
  timestamp: 1_700_000_000_000 + id,
  ...extra,
});

describe('App: history', () => {
  it('shows stored history when a channel opens, in its own wording for each kind', async () => {
    await mount({
      getHistory: [
        entry(1, { event: { type: 'PRIVMSG', nick: 'mira', target: '#dolq', text: 'from the past' } }),
        entry(2, { event: { type: 'ACTION', nick: 'mira', target: '#dolq', text: 'waved back then' } }),
        entry(3, { event: { type: 'NOTICE', nick: 'ChanServ', target: '#dolq', text: 'old notice' } }),
        entry(4, { event: { type: 'JOIN', nick: 'tomas', channel: '#dolq' } }),
        entry(5, {
          event: {
            type: 'XDCCPACK',
            nick: 'bot',
            target: '#dolq',
            number: 3,
            gets: 1,
            size: '1G',
            filename: 'old.iso',
          },
        }),
      ],
    });
    expect(await screen.findByText('from the past')).toBeTruthy();
    expect(screen.getByText('waved back then')).toBeTruthy();
    expect(screen.getByText('old notice')).toBeTruthy();
    expect(screen.getByText(/#3 · 1x sent/)).toBeTruthy();
    expect(screen.getAllByText(/tomas/).length).toBeGreaterThan(0);
  });

  it('shows only server-level lines in the log view', async () => {
    await mount({
      getHistory: [
        entry(1, { channel: '__log__', isRaw: true, line: ':srv 001 me :Welcome' }),
        entry(2, { channel: '__log__', isRaw: true, line: ':bob!b@h PRIVMSG #dolq :already shown elsewhere' }),
      ],
    });
    await fire.click(screen.getByText('Server log'));
    expect(await screen.findByText(/Welcome/)).toBeTruthy();
    expect(screen.queryByText(/already shown elsewhere/)).toBeNull();
  });

  it('fetches history again after the backend connection comes back', async () => {
    const irc = await mount();
    await waitFor(() => expect(irc.spies.getHistory).toHaveBeenCalled());
    const before = irc.spies.getHistory.mock.calls.length;
    irc.emit('onBackendReconnected');
    await waitFor(() => expect(irc.spies.getHistory.mock.calls.length).toBeGreaterThan(before));
  });
});

describe('App: exporting', () => {
  const exported = [entry(1, { event: { type: 'PRIVMSG', nick: 'mira', target: '#dolq', text: 'hi' } })];

  it('saves the channel history as text', async () => {
    const irc = await mount({ getHistory: exported });
    await fire.click(screen.getByRole('button', { name: 'Export log' }));
    await fire.click(screen.getByText('Export as Text'));
    await waitFor(() => expect(irc.spies.saveTextFile).toHaveBeenCalled());
    const [name, content] = irc.spies.saveTextFile.mock.calls[0];
    expect(name).toBe('dolq.txt');
    expect(content).toContain('<mira> hi');
  });

  it('saves the channel history as JSON', async () => {
    const irc = await mount({ getHistory: exported });
    await fire.click(screen.getByRole('button', { name: 'Export log' }));
    await fire.click(screen.getByText('Export as JSON'));
    await waitFor(() => expect(irc.spies.saveTextFile).toHaveBeenCalled());
    const [name, content] = irc.spies.saveTextFile.mock.calls[0];
    expect(name).toBe('dolq.json');
    expect(JSON.parse(content)).toHaveLength(1);
  });

  it('saves nothing rather than a truncated export when history cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const irc = await mount();
    irc.spies.getHistory.mockRejectedValue(new Error('backend down'));
    await fire.click(screen.getByRole('button', { name: 'Export log' }));
    await fire.click(screen.getByText('Export as Text'));
    await waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(irc.spies.saveTextFile).not.toHaveBeenCalled();
  });
});

describe('App: member actions', () => {
  const memberMenu = async (item: string) => {
    await fire.contextMenu(await screen.findByText('mira', { selector: 'span.flex-1' }));
    await fire.click(screen.getByText(item));
  };

  it('looks a member up with whois from the member list', async () => {
    const irc = await mount();
    await memberMenu('WHOIS');
    await waitFor(() => expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'WHOIS mira'));
  });

  it('ignores and unignores a member', async () => {
    await mount();
    await memberMenu('Ignore');
    expect(useStore.getState().ignoredNicks.s1).toEqual(['mira']);
    await memberMenu('Unignore');
    expect(useStore.getState().ignoredNicks.s1).toEqual([]);
  });

  it('offers a DCC chat and opens it', async () => {
    const irc = await mount();
    await memberMenu('DCC Chat');
    await waitFor(() => expect(irc.spies.dccOffer).toHaveBeenCalledWith('s1', 'mira'));
    expect(await screen.findByRole('heading', { name: /mira/ })).toBeTruthy();
    // a DCC chat sends over the DCC link, not the IRC server
    await fire.change(screen.getByPlaceholderText('Message mira'), { target: { value: 'private hello' } });
    await fire.submit(screen.getByPlaceholderText('Message mira').closest('form') as HTMLFormElement);
    await waitFor(() => expect(irc.spies.dccSend).toHaveBeenCalledWith('dcc:2', 'private hello'));
  });

  it('starts a conversation by clicking a member', async () => {
    await mount();
    await fire.click(await screen.findByText('mira', { selector: 'span.flex-1' }));
    expect(await screen.findByRole('heading', { name: '@mira' })).toBeTruthy();
  });

  it('shows who is away', async () => {
    const irc = await mount();
    await screen.findByText('mira', { selector: 'span.flex-1' });
    await irc.event('s1', { type: 'AWAY', nick: 'mira', away: true });
    expect(await screen.findByText(/\(away\)/)).toBeTruthy();
    await irc.event('s1', { type: 'SELFAWAY', away: true });
    expect(useStore.getState().selfAwayMap.s1).toBe(true);
    expect(screen.getByText('Away')).toBeTruthy();
  });
});

describe('App: channels', () => {
  it('leaves, rejoins and removes a channel from its menu', async () => {
    const irc = await mount();
    await fire.contextMenu(screen.getByText('other'));
    await fire.click(screen.getByText('Leave Channel'));
    await waitFor(() => expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'PART #other'));
    await irc.event('s1', { type: 'PART', nick: 'me', channel: '#other' });
    await fire.contextMenu(screen.getByText('other'));
    await fire.click(screen.getByText('Join Channel'));
    await waitFor(() => expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'JOIN #other'));
    await fire.contextMenu(screen.getByText('other'));
    await fire.click(screen.getByText('Remove Channel'));
    await waitFor(() => expect(screen.queryByText('other')).toBeNull());
  });

  it('closes a direct message without leaving anything on the server', async () => {
    const irc = await mount();
    await irc.event('s1', { type: 'PRIVMSG', nick: 'kestrel', target: 'me', text: 'psst' });
    await fire.contextMenu(await screen.findByText('kestrel'));
    await fire.click(screen.getByText('Close'));
    await waitFor(() => expect(screen.queryByText('Direct messages')).toBeNull());
    expect(irc.spies.sendLine).not.toHaveBeenCalledWith('s1', expect.stringContaining('PART kestrel'));
  });

  it('mutes from the toolbar', async () => {
    await mount();
    await fire.click(screen.getByRole('button', { name: 'Mute channel' }));
    expect(useStore.getState().mutedChannels['#dolq']).toBe(true);
    expect(screen.getByRole('button', { name: 'Unmute channel' })).toBeTruthy();
  });
});

describe('App: packs and search results', () => {
  const pack: IrcEvent = {
    type: 'XDCCPACK',
    nick: 'bot',
    target: '#dolq',
    number: 7,
    gets: 3,
    size: '1G',
    filename: 'f.iso',
  };

  it('requests a pack when its announcement is clicked', async () => {
    const irc = await mount();
    await irc.event('s1', pack);
    await fire.click(await screen.findByTitle('Click to request this pack'));
    await waitFor(() => expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'PRIVMSG bot :XDCC SEND #7'));
    // the request reads in the bot's conversation like the same line typed by hand
    expect(await screen.findByText('Direct messages')).toBeTruthy();
    expect(useStore.getState().messageMap['s1:bot'].map((m) => m.text)).toEqual(['XDCC SEND #7']);
  });

  it('auto-accepts the offer that answers a pack we requested', async () => {
    const irc = await mount({ getSettings: { retentionDays: 0, xdccAutoAccept: true } });
    await irc.event('s1', pack);
    await fire.click(await screen.findByTitle('Click to request this pack'));
    await waitFor(() => expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'PRIVMSG bot :XDCC SEND #7'));
    await irc.event('s1', {
      type: 'XDCCSENDOFFER',
      nick: 'bot',
      filename: 'f.iso',
      ip: '1.2.3.4',
      port: 5000,
      size: 10,
    });
    await waitFor(() => expect(irc.spies.xdccAccept).toHaveBeenCalled());
    expect(screen.queryByText('File offer')).toBeNull();
  });

  it('jumps to the channel of a search result', async () => {
    const irc = await mount({
      search: [
        entry(9, {
          channel: '#other',
          event: { type: 'PRIVMSG', nick: 'mira', target: '#other', text: 'needle in a haystack' },
        }),
      ],
    });
    await fire.click(screen.getByRole('button', { name: 'Search history' }));
    await fire.change(screen.getByPlaceholderText('Search for...'), { target: { value: 'needle' } });
    await fire.click(screen.getByRole('button', { name: 'Search' }));
    await fire.click(await screen.findByRole('button', { name: /needle in a haystack/ }));
    expect(screen.getByRole('heading', { name: '#other' })).toBeTruthy();
    expect(screen.queryByText('Search History')).toBeNull();
    expect(irc.spies.search).toHaveBeenCalled();
  });

  it('jumps to the log from a log search result', async () => {
    await mount({ search: [entry(9, { channel: '__log__', isRaw: true, line: ':srv NOTICE * :needle' })] });
    await fire.click(screen.getByRole('button', { name: 'Search history' }));
    await fire.change(screen.getByPlaceholderText('Search for...'), { target: { value: 'needle' } });
    await fire.click(screen.getByRole('button', { name: 'Search' }));
    await fire.click(await screen.findByText(/needle/));
    expect(screen.getByRole('heading', { name: 'Server log' })).toBeTruthy();
  });
});

describe('App: sending a file', () => {
  const query = { id: 'mira', name: 'mira', isLog: false, isQuery: true, joined: true };
  const openQuery = () =>
    seed({
      channelMap: { s1: [log, dolq, other, query] },
      messageMap: { 's1:__log__': [], 's1:#dolq': [], 's1:#other': [], 's1:mira': [] },
      selectedChannelId: 'mira',
    });

  it('offers the chosen file to the person in a direct message and shows it in the transfers', async () => {
    openQuery();
    const irc = await mount({ chooseFile: '/tmp/some dir/a.iso', dccSendFile: 'xdcc:1' });
    await fire.click(screen.getByRole('button', { name: 'Send file' }));
    await waitFor(() => expect(irc.spies.dccSendFile).toHaveBeenCalledWith('s1', 'mira', '/tmp/some dir/a.iso'));
    expect(await screen.findByText('a.iso')).toBeTruthy();
    expect(screen.getByText('Waiting for mira to connect')).toBeTruthy();

    await irc.event('xdcc:1', {
      type: 'XDCCTRANSFER',
      received: 512,
      total: 1024,
      path: '/tmp/some dir/a.iso',
      sending: true,
    });
    expect(await screen.findByText('Sending to mira · 50% of 1.0 KB')).toBeTruthy();
    await irc.event('xdcc:1', {
      type: 'XDCCTRANSFER',
      received: 1024,
      total: 1024,
      path: '/tmp/some dir/a.iso',
      done: true,
      sending: true,
    });
    expect(await screen.findByText('Sent · 1.0 KB')).toBeTruthy();
    expect(useStore.getState().messageMap['s1:mira'].some((m) => m.text === 'Sent a.iso')).toBe(true);
  });

  it('does nothing when the file picker is cancelled', async () => {
    openQuery();
    const irc = await mount({ chooseFile: null });
    await fire.click(screen.getByRole('button', { name: 'Send file' }));
    await waitFor(() => expect(irc.spies.chooseFile).toHaveBeenCalled());
    expect(irc.spies.dccSendFile).not.toHaveBeenCalled();
  });

  it('says in the conversation why a file could not be sent, and why a send failed later', async () => {
    openQuery();
    const irc = await mount({ chooseFile: 'C:\\Users\\me\\a.iso' });
    irc.spies.dccSendFile.mockRejectedValueOnce(new Error('not a file'));
    await fire.click(screen.getByRole('button', { name: 'Send file' }));
    expect(await screen.findByText('Could not send a.iso: not a file')).toBeTruthy();

    irc.spies.dccSendFile.mockResolvedValueOnce('xdcc:2');
    await fire.click(screen.getByRole('button', { name: 'Send file' }));
    await screen.findByText('Waiting for mira to connect');
    await irc.event('xdcc:2', {
      type: 'XDCCTRANSFER',
      received: 0,
      total: 0,
      path: '',
      error: 'peer went away',
      sending: true,
    });
    expect(await screen.findByText('Sending a.iso failed: peer went away')).toBeTruthy();
  });

  it('is reachable from the member menu', async () => {
    const irc = await mount({ chooseFile: '/tmp/b.iso', dccSendFile: 'xdcc:3' });
    await fire.contextMenu(screen.getByText('mira'));
    await fire.click(screen.getByText('Send File…'));
    await waitFor(() => expect(irc.spies.dccSendFile).toHaveBeenCalledWith('s1', 'mira', '/tmp/b.iso'));
  });
});

describe('App: transfers', () => {
  const offer: IrcEvent = {
    type: 'XDCCSENDOFFER',
    nick: 'bot',
    filename: 'f.iso',
    ip: '1.2.3.4',
    port: 5000,
    size: 2048,
    host: 'bot.example',
  };
  const startTransfer = async (irc: Awaited<ReturnType<typeof mount>>) => {
    await irc.event('s1', offer);
    await fire.click(await screen.findByRole('button', { name: 'Accept' }));
    await fire.click(await screen.findByRole('button', { name: 'Transfers' }));
    await screen.findByText('f.iso');
  };

  it('pauses, resumes and cancels a download', async () => {
    const irc = await mount();
    await startTransfer(irc);
    await fire.click(screen.getByRole('button', { name: 'Pause' }));
    expect(irc.spies.xdccPause).toHaveBeenCalledWith('xfer-1');
    await fire.click(screen.getByRole('button', { name: 'Resume' }));
    expect(irc.spies.xdccResume).toHaveBeenCalledWith('xfer-1');
    await fire.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(irc.spies.xdccClose).toHaveBeenCalledWith('xfer-1');
    expect(screen.queryByText('f.iso')).toBeNull();
  });

  it('dismisses a finished download', async () => {
    const irc = await mount();
    await startTransfer(irc);
    await irc.event('xfer-1', { type: 'XDCCTRANSFER', received: 2048, total: 2048, path: '/dl/f.iso', done: true });
    await fire.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('f.iso')).toBeNull();
  });
});

describe('App: connecting', () => {
  it('connects servers set to connect on startup, and leaves the others alone', async () => {
    const quiet: Server = { ...server, id: 's2', name: 'Quiet', initial: 'Q', host: 'quiet.example' };
    seed({
      servers: [{ ...server, connectOnStartup: true }, quiet],
      channelMap: { s1: [log], s2: [{ ...log }] },
      messageMap: { 's1:__log__': [], 's2:__log__': [] },
      nickMap: { s1: 'me', s2: 'me' },
      statusMap: {},
      selectedChannelId: '__log__',
    });
    const irc = await mount({ getStatus: 'disconnected' });
    await waitFor(() => expect(irc.spies.connect).toHaveBeenCalled());
    const hosts = irc.spies.connect.mock.calls.map((c) => c[1]);
    expect(hosts).toEqual(['irc.libera.chat']);
  });

  it('writes a failed connection into the server log', async () => {
    const irc = await mount();
    irc.spies.connect.mockRejectedValueOnce(new Error('connection refused'));
    await typeAndSend('/disconnect');
    await waitFor(() => expect(useStore.getState().statusMap.s1).toBe('disconnected'));
    await typeAndSend('/connect');
    await fire.click(screen.getByText('Server log'));
    expect(await screen.findByText(/connection refused/)).toBeTruthy();
    expect(useStore.getState().statusMap.s1).toBe('disconnected');
  });

  it('connects and disconnects from the toolbar power button', async () => {
    const irc = await mount();
    await fire.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(irc.spies.disconnect).toHaveBeenCalledWith('s1'));
    await fire.click(await screen.findByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(irc.spies.connect).toHaveBeenCalled());
  });
});

describe('App: raw lines and DCC chats', () => {
  it('puts server-level lines in the log and keeps channel traffic out of it', async () => {
    const irc = await mount();
    irc.emit('onLine', 's1', ':srv NOTICE * :server says hi');
    irc.emit('onLine', 's1', ':bob!b@h PRIVMSG #dolq :already a channel event');
    await fire.click(screen.getByText('Server log'));
    expect(await screen.findByText(/server says hi/)).toBeTruthy();
    expect(screen.queryByText(/already a channel event/)).toBeNull();
  });

  it('shows lines from a DCC chat under the peer', async () => {
    const irc = await mount();
    await irc.event('s1', { type: 'DCCCHATOFFER', nick: 'kestrel', ip: '1.2.3.4', port: 5000 });
    await fire.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(useStore.getState().selectedChannelId).toBe('dcc:1'));
    irc.emit('onLine', 'dcc:1', 'hello from the peer');
    expect(await screen.findByText('hello from the peer')).toBeTruthy();
    expect(useStore.getState().messageMap['dcc:1'].at(-1)?.nick).toBe('kestrel');
  });

  it('closes a DCC chat on the DCC link rather than leaving a channel', async () => {
    const irc = await mount();
    await irc.event('s1', { type: 'DCCCHATOFFER', nick: 'kestrel', ip: '1.2.3.4', port: 5000 });
    await fire.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(useStore.getState().selectedChannelId).toBe('dcc:1'));
    await fire.contextMenu(screen.getAllByText('kestrel')[0]);
    await fire.click(screen.getByText('Close'));
    await waitFor(() => expect(irc.spies.dccClose).toHaveBeenCalledWith('dcc:1'));
  });
});

describe('App: ignored senders', () => {
  it('drops actions and pack announcements from ignored nicks', async () => {
    seed({ ignoredNicks: { s1: ['troll'] } });
    const irc = await mount();
    await irc.event('s1', { type: 'ACTION', nick: 'troll', target: '#dolq', text: 'does a thing' });
    await irc.event('s1', {
      type: 'XDCCPACK',
      nick: 'troll',
      target: '#dolq',
      number: 1,
      gets: 1,
      size: '1M',
      filename: 'x',
    });
    expect(screen.queryByText('does a thing')).toBeNull();
    expect(screen.queryByText(/#1 · 1x sent/)).toBeNull();
  });
});

describe('App: notifications', () => {
  it('raises a desktop notification for a mention and jumps to the channel when it is clicked', async () => {
    const instances: { title: string; body: string; onclick?: () => void }[] = [];
    class FakeNotification {
      onclick?: () => void;
      constructor(
        public title: string,
        opts: { body: string },
      ) {
        this.body = opts.body;
        instances.push(this);
      }
      body: string;
    }
    vi.stubGlobal('Notification', FakeNotification);
    try {
      const irc = await mount();
      await irc.event('s1', { type: 'PRIVMSG', nick: 'mira', target: '#other', text: 'me: look at this' });
      expect(instances).toHaveLength(1);
      expect(instances[0].title).toBe('Mentioned in #other');
      expect(instances[0].body).toBe('me: look at this');
      await act(async () => instances[0].onclick?.());
      expect(screen.getByRole('heading', { name: '#other' })).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('App: sending edge cases', () => {
  it('sends plain lines typed in the server log straight to the server', async () => {
    const irc = await mount();
    await fire.click(screen.getByText('Server log'));
    await fire.change(screen.getByPlaceholderText(/Log view/), { target: { value: 'WHO #dolq' } });
    await fire.submit(screen.getByPlaceholderText(/Log view/).closest('form') as HTMLFormElement);
    await waitFor(() => expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'WHO #dolq'));
  });

  it('sends commands that map onto one IRC line, such as /topic', async () => {
    const irc = await mount();
    await typeAndSend('/topic New topic');
    await waitFor(() => expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'TOPIC #dolq :New topic'));
  });

  it('stops an alias that expands into itself instead of looping', async () => {
    seed({ aliases: { loop: '/loop again' } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mount();
    await typeAndSend('/loop');
    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('alias expansion too deep')));
  });

  it('hides joins and quits when that preference is off', async () => {
    seed({ showMembershipEvents: false });
    const irc = await mount();
    await irc.event('s1', { type: 'JOIN', nick: 'tomas', channel: '#dolq' });
    await irc.event('s1', { type: 'PRIVMSG', nick: 'mira', target: '#dolq', text: 'visible line' });
    expect(await screen.findByText('visible line')).toBeTruthy();
    expect(screen.queryByText(/tomas joined/)).toBeNull();
  });
});

describe('App: dialogs close', () => {
  it('closes search, the identify prompt, add-server and edit-server without acting', async () => {
    const irc = await mount();
    await fire.click(screen.getByRole('button', { name: 'Search history' }));
    await fire.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Search History')).toBeNull();

    await irc.event('s1', {
      type: 'NOTICE',
      nick: 'NickServ',
      target: 'me',
      text: 'This nickname is registered. Please identify via /msg NickServ IDENTIFY',
    });
    await fire.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Identify with NickServ')).toBeNull();

    await fire.click(screen.getByRole('button', { name: 'Add server' }));
    await fire.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Add a server' })).toBeNull();

    await fire.contextMenu(screen.getByRole('button', { name: 'Libera' }));
    await fire.click(screen.getByText('Edit Server…'));
    await fire.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Edit server' })).toBeNull();
  });

  it('requests a pack straight from a search result', async () => {
    const irc = await mount({
      search: [
        entry(9, {
          event: { type: 'XDCCPACK', nick: 'bot', target: '#dolq', number: 4, gets: 1, size: '1G', filename: 'f.iso' },
        }),
      ],
    });
    await fire.click(screen.getByRole('button', { name: 'Search history' }));
    await fire.change(screen.getByPlaceholderText('Search for...'), { target: { value: 'f.iso' } });
    await fire.click(screen.getByRole('button', { name: 'Search' }));
    await fire.click(await screen.findByTitle('Click to request this pack'));
    await waitFor(() => expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'PRIVMSG bot :XDCC SEND #4'));
    expect(screen.queryByText('Search History')).toBeNull();
  });
});

describe('App: trust and recovery', () => {
  it('starts a download without asking for a sender trusted earlier', async () => {
    seed({ xdccTrusted: { s1: [{ nick: 'bot', host: 'bot.example' }] } });
    const irc = await mount();
    await irc.event('s1', {
      type: 'XDCCSENDOFFER',
      nick: 'bot',
      filename: 'f.iso',
      ip: '1.2.3.4',
      port: 5000,
      size: 10,
      host: 'bot.example',
    });
    await waitFor(() => expect(irc.spies.xdccAccept).toHaveBeenCalled());
    expect(screen.queryByText('File offer')).toBeNull();
  });

  it('marks a server disconnected when its status cannot be read', async () => {
    seed({ statusMap: {} });
    const irc = installIrc({});
    irc.spies.getStatus.mockRejectedValue(new Error('backend down'));
    render(<App />);
    await waitFor(() => expect(useStore.getState().statusMap.s1).toBe('disconnected'));
  });
});

describe('App: trust ends with the connection', () => {
  it('asks again after the server disconnects, for a sender trusted only for the session', async () => {
    const irc = await mount();
    const offer: IrcEvent = {
      type: 'XDCCSENDOFFER',
      nick: 'bot',
      filename: 'f.iso',
      ip: '1.2.3.4',
      port: 5000,
      size: 10,
      host: 'bot.example',
    };
    await irc.event('s1', offer);
    await fire.click(await screen.findByRole('button', { name: 'Choose how to accept' }));
    await fire.click(screen.getByText(/for this session/));
    await fire.click(screen.getByRole('button', { name: 'Accept for session' }));
    await waitFor(() => expect(irc.spies.xdccAccept).toHaveBeenCalledTimes(1));
    irc.emit('onStatus', 's1', 'disconnected');
    irc.emit('onStatus', 's1', 'connected');
    await irc.event('s1', offer);
    expect(await screen.findByText('File offer')).toBeTruthy();
    expect(irc.spies.xdccAccept).toHaveBeenCalledTimes(1);
  });
});

describe('App: older history', () => {
  const page = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) =>
      entry(from + i, { event: { type: 'PRIVMSG', nick: 'mira', target: '#dolq', text: `old line ${from + i}` } }),
    );

  it('loads the next page when scrolled to the top, and not again once history runs out', async () => {
    const irc = await mount({ getHistory: page(1000, 100) });
    await screen.findAllByText(/old line/);
    const before = irc.spies.getHistory.mock.calls.length;
    irc.spies.getHistory.mockResolvedValueOnce(page(900, 3));
    const scroller = document.querySelector('.overflow-y-auto.py-2') as HTMLElement;
    scroller.scrollTop = 0;
    await fire.scroll(scroller);
    await waitFor(() => expect(irc.spies.getHistory.mock.calls.length).toBe(before + 1));
    expect(irc.spies.getHistory.mock.calls.at(-1)?.[2]).toBe(1000); // continues from the oldest line it has
    await waitFor(() =>
      expect(useStore.getState().messageMap['s1:#dolq'].some((m) => m.text === 'old line 902')).toBe(true),
    );

    // that short page was the last one
    await fire.scroll(scroller);
    await new Promise((r) => setTimeout(r, 20));
    expect(irc.spies.getHistory.mock.calls.length).toBe(before + 1);
  });

  it('keeps working when history cannot be read', async () => {
    const irc = installIrc({});
    irc.spies.getHistory.mockRejectedValue(new Error('backend down'));
    render(<App />);
    await waitFor(() => expect(irc.spies.getHistory).toHaveBeenCalled());
    await irc.event('s1', { type: 'PRIVMSG', nick: 'mira', target: '#dolq', text: 'live line' });
    expect(await screen.findByText('live line')).toBeTruthy();
  });
});

describe('App: odd input', () => {
  it('ignores progress for a transfer it does not know', async () => {
    const irc = await mount();
    await irc.event('ghost', { type: 'XDCCTRANSFER', received: 5, total: 10, path: '/x' });
    await irc.event('ghost', { type: 'XDCCTRANSFER', received: 10, total: 10, path: '/x', done: true });
    expect(screen.queryByText('Done')).toBeNull();
  });

  it('ignores keys that are not shortcuts', async () => {
    await mount();
    await fire.keyDown(window, { key: 'x', altKey: true });
    await fire.keyDown(window, { key: 'a' });
    expect(screen.getByRole('heading', { name: '#dolq' })).toBeTruthy();
    expect(useStore.getState().mutedChannels).toEqual({});
  });

  it('puts the remembered nick into the preset for a server we already use', async () => {
    await mount();
    await fire.click(screen.getByRole('button', { name: 'Add server' }));
    await fire.change(screen.getByLabelText('Network'), { target: { value: 'irc.libera.chat:6697' } });
    expect((screen.getByPlaceholderText('yournick') as HTMLInputElement).value).toBe('me');
  });

  it('still syncs a server whose channel list cannot be read', async () => {
    const irc = installIrc({});
    irc.spies.getJoinedChannels.mockRejectedValue(new Error('down'));
    render(<App />);
    await waitFor(() => expect(irc.spies.getJoinedChannels).toHaveBeenCalled());
    await waitFor(() => expect(useStore.getState().channelMap.s1.find((c) => c.id === '#dolq')?.joined).toBe(false));
  });
});

describe('App: connection errors and credentials', () => {
  it('writes why a new server could not be reached into its log', async () => {
    const irc = await mount();
    irc.spies.connect.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND irc.nowhere.test'));
    await fire.click(screen.getByRole('button', { name: 'Add server' }));
    await fire.change(screen.getByPlaceholderText('irc.libera.chat'), { target: { value: 'irc.nowhere.test' } });
    await fire.change(screen.getByPlaceholderText('yournick'), { target: { value: 'newme' } });
    await fire.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(useStore.getState().servers).toHaveLength(2));
    const added = useStore.getState().servers[1].id;
    await waitFor(() => expect(useStore.getState().messageMap[`${added}:__log__`]?.[0]?.text).toMatch(/ENOTFOUND/));
  });

  it('remembers SASL credentials from the editor only when asked', async () => {
    const irc = await mount({ rememberSecrets: true });
    await fire.contextMenu(screen.getByRole('button', { name: 'Libera' }));
    await fire.click(screen.getByText('Edit Server…'));
    const remember = await screen.findByRole('checkbox', { name: /Remember/i });
    await waitFor(() => expect(remember).not.toBeDisabled());
    await fire.click(remember);
    await fire.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(irc.spies.rememberSecrets).toHaveBeenCalledWith('s1', expect.any(Object)));
    expect(useStore.getState().servers[0].rememberCredentials).toBe(true);
  });
});

describe('App: more flows', () => {
  it('exports an empty channel as an empty file rather than failing', async () => {
    const irc = await mount();
    await fire.click(screen.getByRole('button', { name: 'Export log' }));
    await fire.click(screen.getByText('Export as Text'));
    await waitFor(() => expect(irc.spies.saveTextFile).toHaveBeenCalledWith('dolq.txt', ''));
  });

  it('keeps the credentials of a new server in the keystore when asked', async () => {
    const irc = await mount({ rememberSecrets: true });
    await fire.click(screen.getByRole('button', { name: 'Add server' }));
    await fire.change(screen.getByPlaceholderText('irc.libera.chat'), { target: { value: 'irc.example.org' } });
    await fire.change(screen.getByPlaceholderText('yournick'), { target: { value: 'newme' } });
    const remember = await screen.findByRole('checkbox', { name: /Remember/i });
    await waitFor(() => expect(remember).not.toBeDisabled());
    await fire.click(remember);
    await fire.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(irc.spies.rememberSecrets).toHaveBeenCalled());
    await waitFor(() => expect(useStore.getState().servers.at(-1)?.rememberCredentials).toBe(true));
  });
});
