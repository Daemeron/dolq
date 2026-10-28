import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IrcEvent } from '../../shared/ipc';
import App from './App';
import { useStore } from './store';
import type { Channel, Server } from './types';

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
    dccAccept: 'dcc-1',
    dccOffer: 'dcc-2',
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
      act(() => {
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
  render(<App />);
  await waitFor(() => expect(irc.spies.getSettings).toHaveBeenCalled());
  return irc;
}

beforeEach(() => {
  withLayout();
  seed();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const composer = () => screen.getByPlaceholderText('Message #dolq') as HTMLInputElement;
async function typeAndSend(text: string) {
  fireEvent.change(composer(), { target: { value: text } });
  fireEvent.submit(composer().closest('form') as HTMLFormElement);
}

describe('App: layout', () => {
  it('shows the selected server, its channels and the channel members', async () => {
    await mount();
    expect(screen.getAllByText('Libera').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: '#dolq' })).toBeTruthy();
    expect(screen.getByText('other')).toBeTruthy();
    expect(await screen.findByText('mira')).toBeTruthy();
  });

  it('hides the members panel from the toolbar', async () => {
    await mount();
    await screen.findByText('mira');
    fireEvent.click(screen.getByRole('button', { name: 'Members' }));
    expect(screen.queryByText('mira')).toBeNull();
  });

  it('switches channels from the sidebar', async () => {
    await mount();
    fireEvent.click(screen.getByText('other'));
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
    fireEvent.click(screen.getByRole('button', { name: 'Mentions' }));
    fireEvent.click(screen.getByText('#other'));
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
    fireEvent.click(screen.getByText('Server log'));
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
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
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

describe('App: dialogs', () => {
  it('opens and closes preferences from the sidebar and Escape', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    expect(screen.getByRole('dialog', { name: 'Preferences' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Preferences' })).toBeNull();
  });

  it('opens preferences when the menu asks for it, and saves them', async () => {
    const irc = await mount();
    irc.emit('onOpenPreferences');
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form') as HTMLFormElement);
    await waitFor(() => expect(irc.spies.setSettings).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Preferences' })).toBeNull());
  });

  it('opens the add-server dialog, prefilled from an irc:// link', async () => {
    const irc = await mount();
    irc.emit('onOpenIrcUrl', { host: 'irc.example.org', port: 6667, secure: false, channel: '#hi' });
    expect(await screen.findByRole('dialog', { name: 'Add a Server' })).toBeTruthy();
    expect((screen.getByPlaceholderText('irc.libera.chat') as HTMLInputElement).value).toBe('irc.example.org');
  });

  it('adds a server and connects to it', async () => {
    const irc = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }));
    fireEvent.change(screen.getByPlaceholderText('irc.libera.chat'), { target: { value: 'irc.example.org' } });
    fireEvent.change(screen.getByPlaceholderText('yournick'), { target: { value: 'newme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(irc.spies.connect).toHaveBeenCalled());
    expect(useStore.getState().servers).toHaveLength(2);
  });

  it('opens the server editor from its menu', async () => {
    await mount();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Libera' }));
    fireEvent.click(screen.getByText('Edit Server…'));
    expect(await screen.findByRole('dialog', { name: 'Edit Server' })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('My Server'), { target: { value: 'Libera 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(useStore.getState().servers[0].name).toBe('Libera 2'));
  });

  it('removes a server after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const irc = await mount();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Libera' }));
    fireEvent.click(screen.getByText('Remove Server'));
    await waitFor(() => expect(useStore.getState().servers).toHaveLength(0));
    expect(irc.spies.forgetSecrets).toHaveBeenCalledWith('s1');
  });

  it('keeps the server when removal is not confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await mount();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Libera' }));
    fireEvent.click(screen.getByText('Remove Server'));
    expect(useStore.getState().servers).toHaveLength(1);
  });

  it('opens search from the toolbar', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Search history' }));
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
    fireEvent.change(await screen.findByPlaceholderText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Identify' }));
    await waitFor(() => expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'PRIVMSG NickServ :identify pw'));
  });

  it('accepts a DCC chat offer', async () => {
    const irc = await mount();
    await irc.event('s1', { type: 'DCCCHATOFFER', nick: 'kestrel', ip: '1.2.3.4', port: 5000 });
    expect(await screen.findByText('DCC Chat Request')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(irc.spies.dccAccept).toHaveBeenCalledWith('1.2.3.4', 5000));
    expect((await screen.findAllByText('kestrel')).length).toBeGreaterThan(0);
  });

  it('declines a DCC chat offer', async () => {
    const irc = await mount();
    await irc.event('s1', { type: 'DCCCHATOFFER', nick: 'kestrel', ip: '1.2.3.4', port: 5000 });
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    expect(irc.spies.dccAccept).not.toHaveBeenCalled();
    expect(screen.queryByText('DCC Chat Request')).toBeNull();
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
    expect(await screen.findByText('File Offer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(irc.spies.xdccAccept).toHaveBeenCalledWith('s1', 'bot', '1.2.3.4', 5000, 'f.iso', 2048, undefined),
    );
    expect(await screen.findByText('f.iso')).toBeTruthy();
    await irc.event('xfer-1', { type: 'XDCCTRANSFER', received: 1024, total: 2048, path: '/dl/f.iso' });
    expect(await screen.findByText(/50%/)).toBeTruthy();
    await irc.event('xfer-1', { type: 'XDCCTRANSFER', received: 2048, total: 2048, path: '/dl/f.iso', done: true });
    expect(await screen.findByText('Done')).toBeTruthy();
  });

  it('trusts a sender for the session and skips the prompt the next time', async () => {
    const irc = await mount();
    await irc.event('s1', offer);
    fireEvent.click(await screen.findByText(/until this server disconnects/));
    await waitFor(() => expect(irc.spies.xdccAccept).toHaveBeenCalledTimes(1));
    await irc.event('s1', offer);
    await waitFor(() => expect(irc.spies.xdccAccept).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('File Offer')).toBeNull();
  });

  it('remembers a sender permanently when asked', async () => {
    const irc = await mount();
    await irc.event('s1', offer);
    fireEvent.click(await screen.findByText(/always trust/));
    await waitFor(() => expect(useStore.getState().xdccTrusted.s1).toHaveLength(1));
    expect(irc.spies.xdccAccept).toHaveBeenCalled();
  });

  it('declines a file offer', async () => {
    const irc = await mount();
    await irc.event('s1', offer);
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    expect(irc.spies.xdccAccept).not.toHaveBeenCalled();
    expect(screen.queryByText('File Offer')).toBeNull();
  });

  it('reports a failed download in the transfer card', async () => {
    const irc = await mount();
    await irc.event('s1', offer);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await screen.findByText('f.iso');
    await irc.event('xfer-1', { type: 'XDCCTRANSFER', received: 0, total: 2048, path: '', error: 'connection reset' });
    expect(await screen.findByText(/Failed: connection reset/)).toBeTruthy();
  });

  it('hides and re-shows the transfer cards from the toolbar', async () => {
    const irc = await mount();
    await irc.event('s1', offer);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await screen.findByText('f.iso');
    fireEvent.click(screen.getByRole('button', { name: 'Transfers' }));
    expect(screen.queryByText('f.iso')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Transfers' }));
    expect(screen.getByText('f.iso')).toBeTruthy();
  });
});

describe('App: keyboard shortcuts', () => {
  it('moves between channels and mutes with the configured keys', async () => {
    await mount();
    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
    expect(screen.getByRole('heading', { name: '#other' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowUp', altKey: true });
    expect(screen.getByRole('heading', { name: '#dolq' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'm', altKey: true });
    expect(useStore.getState().mutedChannels['#dolq']).toBe(true);
  });

  it('leaves the current channel with the close shortcut', async () => {
    const irc = await mount();
    fireEvent.keyDown(window, { key: 'w', altKey: true });
    await waitFor(() => expect(irc.spies.sendLine).toHaveBeenCalledWith('s1', 'PART #dolq'));
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
});
