import type { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IrcMessages } from '../shared/ipc';

// The Electron entry point wires the whole app together, so these tests stand in for Electron
// itself and check what it does with each OS event, IPC call and setting.
const h = vi.hoisted(() => {
  type Fn = (...args: never[]) => unknown;
  const state = {
    lock: true,
    userData: '',
    settings: { retentionDays: 3 } as Record<string, unknown>,
    ipc: new Map<string, Fn>(),
    appHandlers: new Map<string, Fn>(),
    windows: [] as unknown[],
    trays: [] as unknown[],
    backends: [] as unknown[],
    menuTemplate: undefined as unknown,
    saved: [] as unknown[],
    enc: { available: false, backend: 'basic_text' },
    dialog: {
      showMessageBox: undefined as unknown as ReturnType<typeof import('vitest').vi.fn>,
    },
  };
  return state;
});

vi.mock('electron', () => {
  class FakeWindow {
    options: unknown;
    url = '';
    destroyed = false;
    visible = true;
    loading = false;
    handlers = new Map<string, (...args: never[]) => unknown>();
    webContentsHandlers = new Map<string, (...args: never[]) => unknown>();
    windowOpenHandler?: (d: { url: string }) => { action: string };
    sent: unknown[][] = [];
    zoom = 1;
    hide = vi.fn(() => {
      this.visible = false;
    });
    show = vi.fn(() => {
      this.visible = true;
    });
    focus = vi.fn();
    webContents = {
      setWindowOpenHandler: (fn: (d: { url: string }) => { action: string }) => {
        this.windowOpenHandler = fn;
      },
      on: (name: string, fn: (...args: never[]) => unknown) => this.webContentsHandlers.set(name, fn),
      send: (...args: unknown[]) => this.sent.push(args),
      isLoadingMainFrame: () => this.loading,
      setZoomFactor: (f: number) => {
        this.zoom = f;
      },
    };
    constructor(options: unknown) {
      this.options = options;
      h.windows.push(this);
    }
    loadURL(url: string) {
      this.url = url;
    }
    on(name: string, fn: (...args: never[]) => unknown) {
      this.handlers.set(name, fn);
    }
    isDestroyed() {
      return this.destroyed;
    }
    isVisible() {
      return this.visible;
    }
  }
  class FakeTray {
    destroyed = false;
    handlers = new Map<string, () => void>();
    tooltip = '';
    menu: unknown;
    constructor() {
      h.trays.push(this);
    }
    setToolTip(t: string) {
      this.tooltip = t;
    }
    setContextMenu(m: unknown) {
      this.menu = m;
    }
    on(name: string, fn: () => void) {
      this.handlers.set(name, fn);
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return {
    app: {
      name: 'Dolq',
      isPackaged: false,
      dock: { setIcon: vi.fn() },
      setName: vi.fn(),
      requestSingleInstanceLock: () => h.lock,
      quit: vi.fn(),
      on: (name: string, fn: (...args: never[]) => unknown) => h.appHandlers.set(name, fn),
      whenReady: () => Promise.resolve(),
      setAsDefaultProtocolClient: vi.fn(),
      setBadgeCount: vi.fn(),
      getPath: (name: string) => (name === 'userData' ? h.userData : `/downloads-${name}`),
    },
    BrowserWindow: FakeWindow,
    Tray: FakeTray,
    Menu: {
      buildFromTemplate: (t: unknown) => t,
      setApplicationMenu: vi.fn((t: unknown) => {
        h.menuTemplate = t;
      }),
    },
    nativeImage: { createFromPath: () => ({ setTemplateImage: vi.fn() }) },
    ipcMain: { handle: (channel: string, fn: (...args: never[]) => unknown) => h.ipc.set(channel, fn) },
    dialog: {
      showErrorBox: vi.fn(),
      showMessageBox: (...args: unknown[]) => (h.dialog.showMessageBox as (...a: unknown[]) => unknown)(...args),
      showSaveDialog: vi.fn(),
      showOpenDialog: vi.fn(),
    },
    safeStorage: {
      isEncryptionAvailable: () => h.enc.available,
      getSelectedStorageBackend: () => h.enc.backend,
      encryptString: (s: string) => Buffer.from(s),
      decryptString: (b: Buffer) => b.toString(),
    },
    shell: { openExternal: vi.fn(), showItemInFolder: vi.fn(), beep: vi.fn() },
  };
});

vi.mock('electron-devtools-installer', () => ({
  installExtension: vi.fn().mockResolvedValue({ name: 'React DevTools' }),
  REACT_DEVELOPER_TOOLS: 'react',
}));

vi.mock('./settings', () => ({
  loadSettings: () => ({ ...h.settings }),
  saveSettings: (s: unknown) => h.saved.push(s),
}));

vi.mock('./irc/BackendClient', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeBackend extends EventEmitter {
    args: unknown[];
    calls: [string, unknown[]][] = [];
    stop = vi.fn(() => Promise.resolve());
    isRemote: boolean;
    constructor(...args: unknown[]) {
      super();
      this.args = args;
      this.isRemote = args[1] !== undefined;
      h.backends.push(this);
      for (const m of [
        'connect',
        'send',
        'disconnect',
        'getStatus',
        'getJoinedChannels',
        'getHistory',
        'search',
        'dccOffer',
        'dccSendFile',
        'dccAccept',
        'dccSend',
        'dccClose',
        'xdccAccept',
        'xdccClose',
        'xdccPause',
        'xdccResume',
      ]) {
        (this as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => {
          this.calls.push([m, a]);
          return Promise.resolve(`${m}-result`);
        };
      }
    }
  }
  return { BackendClient: FakeBackend };
});

type FakeWin = {
  options: Record<string, unknown>;
  url: string;
  destroyed: boolean;
  visible: boolean;
  loading: boolean;
  handlers: Map<string, (...args: unknown[]) => unknown>;
  webContentsHandlers: Map<string, (...args: unknown[]) => unknown>;
  windowOpenHandler: (d: { url: string }) => { action: string };
  sent: unknown[][];
  zoom: number;
  hide: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
};
type FakeBackendT = EventEmitter & {
  args: unknown[];
  calls: [string, unknown[]][];
  stop: ReturnType<typeof vi.fn>;
  isRemote: boolean;
};
type FakeTrayT = { destroyed: boolean; tooltip: string; handlers: Map<string, () => void>; menu: unknown };

const win = () => h.windows.at(-1) as FakeWin;
const backend = () => h.backends.at(-1) as FakeBackendT;
const invoke = (channel: string, ...args: unknown[]) =>
  (h.ipc.get(channel) as (...a: unknown[]) => unknown)({}, ...args);
const appHandler = (name: string) => h.appHandlers.get(name) as (...a: unknown[]) => unknown;

async function boot(settings: Record<string, unknown> = { retentionDays: 3 }) {
  h.settings = settings;
  vi.resetModules();
  await import('./index.js');
  await vi.waitFor(() => expect(h.backends.length).toBe(1));
  return { electron: await import('electron') };
}

let originalArgv: string[];
beforeEach(() => {
  vi.clearAllMocks();
  h.lock = true;
  h.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dolq-main-'));
  h.ipc.clear();
  h.appHandlers.clear();
  h.windows.length = 0;
  h.trays.length = 0;
  h.backends.length = 0;
  h.saved.length = 0;
  h.menuTemplate = undefined;
  h.enc = { available: false, backend: 'basic_text' };
  h.dialog.showMessageBox = vi.fn().mockResolvedValue({ response: 0 });
  originalArgv = process.argv;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  process.argv = originalArgv;
  fs.rmSync(h.userData, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('startup', () => {
  it('quits at once when another Dolq already runs', async () => {
    h.lock = false;
    vi.resetModules();
    const { app } = await import('electron');
    await import('./index.js');
    expect(app.quit).toHaveBeenCalled();
    expect(h.windows).toHaveLength(0);
  });

  it('opens the window on the renderer, starts the backend and builds the menu', async () => {
    await boot({ retentionDays: 9 });
    expect(win().options).toMatchObject({ minWidth: 800, minHeight: 600 });
    expect(win().url).toMatch(/renderer\/index\.html$|^http/);
    expect(backend().args[0]).toBe(9);
    expect(backend().args[1]).toBeUndefined(); // no remote backend configured
    expect(h.trays).toHaveLength(0);
    const menu = h.menuTemplate as { role?: string; label?: string; submenu?: { label?: string }[] }[];
    expect(menu.some((m) => m.role === 'editMenu')).toBe(true);
    const hasPrefs = menu.some((m) => m.submenu?.some((i) => i.label === 'Preferences…'));
    expect(hasPrefs).toBe(process.platform === 'darwin');
  });

  it('shows the tray icon when the setting is on, and toggles the window from it', async () => {
    await boot({ retentionDays: 0, trayEnabled: true });
    const tray = h.trays[0] as FakeTrayT;
    expect(tray.tooltip).toBe('Dolq');
    tray.handlers.get('click')?.();
    expect(win().hide).toHaveBeenCalled();
    tray.handlers.get('click')?.();
    expect(win().show).toHaveBeenCalled();
  });

  it('connects to the configured remote backend with its saved token', async () => {
    await boot({
      retentionDays: 0,
      remoteEnabled: true,
      remoteUrl: 'box.example:6789',
      remoteTls: true,
      remoteToken: 'tok',
    });
    expect(backend().args[1]).toMatchObject({ host: 'box.example', port: 6789, tls: true, token: 'tok' });
  });

  it('shows a backend failure to the user', async () => {
    const { electron } = await boot();
    backend().emit('fatal', 'dolqd exploded');
    expect(electron.dialog.showErrorBox).toHaveBeenCalledWith('Dolq backend', 'dolqd exploded');
  });

  it('installs the React devtools only in development', async () => {
    const { installExtension } = await import('electron-devtools-installer');
    await boot();
    await vi.waitFor(() => expect(installExtension).toHaveBeenCalled());
  });
});

describe('window behaviour', () => {
  it('sends web links to the browser and refuses everything else, never opening a window', async () => {
    const { electron } = await boot();
    expect(win().windowOpenHandler({ url: 'https://example.org' })).toEqual({ action: 'deny' });
    expect(electron.shell.openExternal).toHaveBeenCalledWith('https://example.org');
    win().windowOpenHandler({ url: 'file:///etc/passwd' });
    expect(electron.shell.openExternal).toHaveBeenCalledTimes(1);
  });

  it('blocks navigating the window away from the app', async () => {
    await boot();
    const willNavigate = win().webContentsHandlers.get('will-navigate') as (
      e: { preventDefault: () => void },
      url: string,
    ) => void;
    const away = { preventDefault: vi.fn() };
    willNavigate(away, 'https://evil.example');
    expect(away.preventDefault).toHaveBeenCalled();
    const stay = { preventDefault: vi.fn() };
    willNavigate(stay, win().url);
    expect(stay.preventDefault).not.toHaveBeenCalled();
  });

  it('hides instead of closing while the tray exists, and closes for real once quitting', async () => {
    await boot({ retentionDays: 0, trayEnabled: true });
    const close = win().handlers.get('close') as (e: { preventDefault: () => void }) => void;
    const e1 = { preventDefault: vi.fn() };
    close(e1);
    expect(e1.preventDefault).toHaveBeenCalled();
    expect(win().hide).toHaveBeenCalled();

    const e2 = { preventDefault: vi.fn() };
    await appHandler('before-quit')({ preventDefault: vi.fn() });
    close(e2);
    expect(e2.preventDefault).not.toHaveBeenCalled();
  });

  it('closes normally without a tray', async () => {
    await boot();
    const e = { preventDefault: vi.fn() };
    (win().handlers.get('close') as (e: unknown) => void)(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('quits when the last window closes, except on macOS', async () => {
    const { electron } = await boot();
    appHandler('window-all-closed')();
    expect(electron.app.quit).toHaveBeenCalledTimes(process.platform === 'darwin' ? 0 : 1);
  });

  it('brings the window back when the app is activated', async () => {
    await boot();
    win().visible = false;
    appHandler('activate')();
    expect(win().show).toHaveBeenCalled();
  });

  it('stops the backend before quitting, once', async () => {
    const { electron } = await boot();
    const first = { preventDefault: vi.fn() };
    appHandler('before-quit')(first);
    expect(first.preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled());
    expect(backend().stop).toHaveBeenCalledTimes(1);
    const second = { preventDefault: vi.fn() };
    appHandler('before-quit')(second);
    expect(second.preventDefault).not.toHaveBeenCalled();
    expect(backend().stop).toHaveBeenCalledTimes(1);
  });
});

describe('lifecycle edges', () => {
  it('builds a fresh window when the old one was destroyed', async () => {
    await boot();
    win().destroyed = true;
    appHandler('activate')();
    expect(h.windows).toHaveLength(2);
  });

  it('quits from the tray menu and shows the window from it', async () => {
    const { electron } = await boot({ retentionDays: 0, trayEnabled: true });
    const items = (h.trays[0] as FakeTrayT).menu as { label?: string; click?: () => void }[];
    items.find((i) => i.label === 'Show Dolq')?.click?.();
    expect(win().show).toHaveBeenCalled();
    items.find((i) => i.label === 'Quit')?.click?.();
    expect(electron.app.quit).toHaveBeenCalled();
  });

  it('registers itself for irc and ircs links', async () => {
    const { electron } = await boot();
    const schemes = vi.mocked(electron.app.setAsDefaultProtocolClient).mock.calls.map((c) => c[0]);
    expect(schemes).toEqual(['irc', 'ircs']);
  });

  it('survives the React devtools failing to install', async () => {
    const { installExtension } = await import('electron-devtools-installer');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(installExtension).mockRejectedValueOnce(new Error('offline'));
    await boot();
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
  });

  it('re-delivers a queued link through a new window when the old one is gone', async () => {
    await boot();
    win().destroyed = true;
    appHandler('open-url')({ preventDefault: vi.fn() }, 'irc://irc.example.org');
    expect(h.windows).toHaveLength(2);
    win().webContentsHandlers.get('did-finish-load')?.();
    expect(win().sent.some((s) => s[0] === IrcMessages.openIrcUrl)).toBe(true);
  });
});

describe('irc:// links', () => {
  it('hands a link to the page once it has loaded, and shows the window', async () => {
    await boot();
    win().visible = false;
    appHandler('open-url')({ preventDefault: vi.fn() }, 'ircs://irc.libera.chat/#dolq');
    expect(win().sent).toContainEqual([
      IrcMessages.openIrcUrl,
      { host: 'irc.libera.chat', port: 6697, secure: true, channel: '#dolq' },
    ]);
    expect(win().show).toHaveBeenCalled();
  });

  it('holds a link until the page has finished loading', async () => {
    await boot();
    win().loading = true;
    appHandler('open-url')({ preventDefault: vi.fn() }, 'irc://irc.example.org');
    expect(win().sent).toHaveLength(0);
    win().loading = false;
    (win().webContentsHandlers.get('did-finish-load') as () => void)();
    expect(win().sent[0][0]).toBe(IrcMessages.openIrcUrl);
  });

  it('drops a malformed link instead of sending it on', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await boot();
    appHandler('open-url')({ preventDefault: vi.fn() }, 'irc://');
    expect(win().sent).toHaveLength(0);
    expect(error).toHaveBeenCalled();
  });

  it('takes the link from a second launch, or just focuses the window when there is none', async () => {
    await boot();
    appHandler('second-instance')({}, ['dolq', '--flag', 'irc://irc.example.org:6667']);
    expect(win().sent).toHaveLength(1);
    win().show.mockClear();
    appHandler('second-instance')({}, ['dolq']);
    expect(win().show).toHaveBeenCalled();
    expect(win().sent).toHaveLength(1);
  });

  it('opens a link the app was launched with', async () => {
    process.argv = ['dolq', 'irc://irc.cold.example'];
    await boot();
    expect(win().sent.some((s) => s[0] === IrcMessages.openIrcUrl)).toBe(true);
  });
});

describe('IPC handlers', () => {
  it('forwards IRC requests to the backend', async () => {
    await boot();
    await invoke(IrcMessages.send, 's1', 'JOIN #a');
    await invoke(IrcMessages.disconnect, 's1');
    await invoke(IrcMessages.getStatus, 's1');
    await invoke(IrcMessages.getJoinedChannels, 's1');
    await invoke(IrcMessages.getHistory, 's1', '#a', 1, 2);
    await invoke(IrcMessages.search, 's1', '#a', 'q', 3);
    await invoke(IrcMessages.dccAccept, '1.2.3.4', 5);
    await invoke(IrcMessages.dccSend, 'd', 'hi');
    await invoke(IrcMessages.dccClose, 'd');
    await invoke(IrcMessages.xdccClose, 'x');
    await invoke(IrcMessages.xdccPause, 'x');
    await invoke(IrcMessages.xdccResume, 'x');
    expect(backend().calls.map(([m]) => m)).toEqual([
      'send',
      'disconnect',
      'getStatus',
      'getJoinedChannels',
      'getHistory',
      'search',
      'dccAccept',
      'dccSend',
      'dccClose',
      'xdccClose',
      'xdccPause',
      'xdccResume',
    ]);
    expect(backend().calls[4][1]).toEqual(['s1', '#a', 1, 2]);
  });

  it('connects with what the renderer sent when nothing is saved', async () => {
    await boot();
    await invoke(IrcMessages.connect, 's1', 'irc.example', 6697, 'me', true, 'u', 'p', 'user', 'Real', ['alt'], 'pw');
    expect(backend().calls[0]).toEqual([
      'connect',
      ['s1', 'irc.example', 6697, 'me', true, 'u', 'p', 'user', 'Real', ['alt'], 'pw'],
    ]);
  });

  it('uses the configured DCC port range, defaulting to any port', async () => {
    await boot({ retentionDays: 0, dccPortMin: 5000, dccPortMax: 5010 });
    await invoke(IrcMessages.dccOffer, 's1', 'mira');
    expect(backend().calls[0]).toEqual(['dccOffer', ['s1', 'mira', 5000, 5010]]);
  });

  it('sends a file through the backend with the DCC port range, but not through a remote one', async () => {
    await boot({ retentionDays: 0, dccPortMin: 5000, dccPortMax: 5010 });
    await invoke(IrcMessages.dccSendFile, 's1', 'mira', '/tmp/a.iso');
    expect(backend().calls[0]).toEqual(['dccSendFile', ['s1', 'mira', '/tmp/a.iso', 5000, 5010]]);
    backend().isRemote = true;
    expect(() => invoke(IrcMessages.dccSendFile, 's1', 'mira', '/tmp/a.iso')).toThrow(
      /backend to run on this computer/,
    );
  });

  it('picks a file to send, or nothing when the picker is cancelled', async () => {
    const { electron } = await boot();
    vi.mocked(electron.dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/pick.iso'] });
    expect(await invoke(IrcMessages.chooseFile)).toBe('/pick.iso');
    vi.mocked(electron.dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await invoke(IrcMessages.chooseFile)).toBeNull();
  });

  it('downloads into the chosen folder, else the OS downloads folder', async () => {
    await boot({ retentionDays: 0, downloadDir: '/chosen' });
    await invoke(IrcMessages.xdccAccept, 's1', 'bot', '1.2.3.4', 5, 'f.iso', 99, 'tok');
    expect(backend().calls[0][1][7]).toBe('/chosen');
  });

  it('falls back to the downloads folder', async () => {
    await boot();
    await invoke(IrcMessages.xdccAccept, 's1', 'bot', '1.2.3.4', 5, 'f.iso', 99);
    expect(backend().calls[0][1][7]).toBe('/downloads-downloads');
    expect(backend().calls[0][1].slice(8)).toEqual([0, 0]);
  });

  it('relays backend traffic to the window', async () => {
    await boot();
    backend().emit('line', 's1', ':srv');
    backend().emit('event', 's1', { type: 'JOIN' });
    backend().emit('status', 's1', 'connected');
    backend().emit('reconnected');
    expect(win().sent).toEqual([
      [IrcMessages.line, 's1', ':srv'],
      [IrcMessages.event, 's1', { type: 'JOIN' }],
      [IrcMessages.status, 's1', 'connected'],
      [IrcMessages.backendReconnected],
    ]);
  });

  it('does not message a window that is gone', async () => {
    await boot();
    win().destroyed = true;
    backend().emit('line', 's1', ':srv');
    expect(win().sent).toHaveLength(0);
  });

  it('opens only http(s) links externally', async () => {
    const { electron } = await boot();
    await invoke(IrcMessages.openExternal, 'https://example.org');
    expect(electron.shell.openExternal).toHaveBeenCalledWith('https://example.org');
    expect(() => invoke(IrcMessages.openExternal, 'javascript:alert(1)')).toThrow(/refusing/);
  });

  it('reveals an absolute path in the file manager and refuses anything else', async () => {
    const { electron } = await boot();
    await invoke(IrcMessages.showInFolder, '/tmp/a.iso');
    expect(electron.shell.showItemInFolder).toHaveBeenCalledWith('/tmp/a.iso');
    expect(() => invoke(IrcMessages.showInFolder, 'relative/a.iso')).toThrow(/refusing/);
    expect(() => invoke(IrcMessages.showInFolder, 42)).toThrow(/refusing/);
  });

  it('updates the dock badge, zoom and alert sound', async () => {
    const { electron } = await boot();
    await invoke(IrcMessages.setBadgeCount, 4);
    expect(electron.app.setBadgeCount).toHaveBeenCalledWith(4);
    await invoke(IrcMessages.setZoomFactor, 1.25);
    expect(win().zoom).toBe(1.25);
    await invoke(IrcMessages.playAlertSound);
    expect(electron.shell.beep).toHaveBeenCalled();
  });

  it('saves a text file where the user chooses, or nothing when they cancel', async () => {
    const { electron } = await boot();
    const target = path.join(h.userData, 'export.txt');
    vi.mocked(electron.dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: target });
    expect(await invoke(IrcMessages.saveTextFile, 'log.txt', 'hello')).toBe(true);
    expect(fs.readFileSync(target, 'utf-8')).toBe('hello');

    vi.mocked(electron.dialog.showSaveDialog).mockResolvedValueOnce({ canceled: true, filePath: '' });
    expect(await invoke(IrcMessages.saveTextFile, 'log.txt', 'x')).toBe(false);
  });

  it('picks a directory, or null when cancelled', async () => {
    const { electron } = await boot();
    vi.mocked(electron.dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/pick'] });
    expect(await invoke(IrcMessages.chooseDirectory, '/start')).toBe('/pick');
    vi.mocked(electron.dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await invoke(IrcMessages.chooseDirectory)).toBeNull();
  });
});

describe('settings and secrets', () => {
  it('reports settings without the token, and whether one is saved', async () => {
    await boot({ retentionDays: 0, remoteToken: 'secret' });
    const settings = (await invoke(IrcMessages.getSettings)) as Record<string, unknown>;
    expect(settings.remoteToken).toBeUndefined();
    expect(settings.remoteTokenSet).toBe(true);
  });

  it('saves new settings and creates or removes the tray with them', async () => {
    await boot();
    await invoke(IrcMessages.setSettings, { retentionDays: 5, trayEnabled: true });
    expect(h.saved.at(-1)).toMatchObject({ retentionDays: 5, trayEnabled: true });
    expect(h.trays).toHaveLength(1);
    await invoke(IrcMessages.setSettings, { retentionDays: 5, trayEnabled: true });
    expect(h.trays).toHaveLength(1); // already there
    await invoke(IrcMessages.setSettings, { retentionDays: 5, trayEnabled: false });
    expect((h.trays[0] as FakeTrayT).destroyed).toBe(true);
  });

  it('reports that there is no keystore here and keeps the secrets calls working', async () => {
    await boot();
    expect(await invoke(IrcMessages.secretsAvailable)).toBe(false);
    await invoke(IrcMessages.secretsRemember, 's1', { password: 'p' });
    await invoke(IrcMessages.secretsForget, 's1');
  });
});

describe('saved credentials', () => {
  it('stores secrets in the OS keystore and fills them in when connecting', async () => {
    h.enc = { available: true, backend: 'gnome_libsecret' };
    await boot();
    expect(await invoke(IrcMessages.secretsAvailable)).toBe(true);
    await invoke(IrcMessages.secretsRemember, 's1', { password: 'server-pw', saslUser: 'u', saslPass: 'p' });
    await invoke(IrcMessages.connect, 's1', 'irc.example', 6697, 'me', true);
    const args = backend().calls.find(([m]) => m === 'connect')?.[1] as unknown[];
    expect(args[5]).toBe('u');
    expect(args[6]).toBe('p');
    expect(args[10]).toBe('server-pw');
    // the file on disk holds no plain text
    const stored = fs.readFileSync(path.join(h.userData, 'secrets.json'), 'utf-8');
    expect(stored).not.toContain('server-pw');
  });

  it('refuses the keystore on Linux when it would only store plain text', async () => {
    h.enc = { available: true, backend: 'basic_text' };
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      await boot();
      expect(await invoke(IrcMessages.secretsAvailable)).toBe(false);
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true });
    }
  });
});

describe('platform differences', () => {
  const asPlatform = async (platform: string, fn: () => Promise<void>) => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    try {
      await fn();
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true });
    }
  };

  it('has no app menu or Preferences item outside macOS, and quits when the window closes', async () => {
    await asPlatform('linux', async () => {
      const { electron } = await boot();
      const menu = h.menuTemplate as { label?: string }[];
      expect(menu.some((m) => m.label === 'Dolq')).toBe(false);
      appHandler('window-all-closed')();
      expect(electron.app.quit).toHaveBeenCalled();
    });
  });

  it('opens Preferences from the macOS app menu', async () => {
    await asPlatform('darwin', async () => {
      await boot();
      const menu = h.menuTemplate as { label?: string; submenu?: { label?: string; click?: () => void }[] }[];
      const prefs = menu.find((m) => m.label === 'Dolq')?.submenu?.find((i) => i.label === 'Preferences…');
      win().visible = false;
      prefs?.click?.();
      expect(win().sent).toContainEqual([IrcMessages.openPreferences]);
      expect(win().show).toHaveBeenCalled();
    });
  });

  it('registers a development build with the path of the script it runs', async () => {
    const proc = process as unknown as { defaultApp?: boolean };
    const originalArgv = process.argv;
    proc.defaultApp = true;
    process.argv = ['electron', '/work/dolq/out/main/index.js'];
    try {
      const { electron } = await boot();
      expect(electron.app.setAsDefaultProtocolClient).toHaveBeenCalledWith('irc', process.execPath, [
        path.resolve('/work/dolq/out/main/index.js'),
      ]);
    } finally {
      proc.defaultApp = undefined;
      process.argv = originalArgv;
    }
  });
});

describe('remote backend prompts', () => {
  const remoteSettings = { retentionDays: 0, remoteEnabled: true, remoteUrl: 'box.example:6789', remoteTls: true };
  const hooks = () =>
    backend().args[2] as {
      confirmTrust: (fp: string, host: string) => Promise<boolean>;
      confirmInsecure: (host: string, reasons: string[]) => Promise<boolean>;
      onPin: (fp: string) => void;
    };

  it('asks before trusting a self-signed certificate, showing its fingerprint', async () => {
    await boot(remoteSettings);
    expect(await hooks().confirmTrust('AA:BB', 'box.example')).toBe(true);
    const [, options] = (h.dialog.showMessageBox as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options.message).toContain('box.example');
    expect(options.detail).toContain('AA:BB');
    h.dialog.showMessageBox = vi.fn().mockResolvedValue({ response: 1 });
    expect(await hooks().confirmTrust('AA:BB', 'box.example')).toBe(false);
  });

  it('lists what is unprotected before connecting anyway', async () => {
    await boot(remoteSettings);
    await hooks().confirmInsecure('box.example', ['not encrypted', 'no token']);
    const [, options] = (h.dialog.showMessageBox as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options.detail).toContain('- not encrypted');
    expect(options.detail).toContain('- no token');
  });

  it('remembers an accepted certificate', async () => {
    await boot(remoteSettings);
    hooks().onPin('AA:BB');
    expect(h.saved.at(-1)).toMatchObject({ remoteFingerprint: 'AA:BB' });
  });
});
