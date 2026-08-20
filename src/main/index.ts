import { installExtension, REACT_DEVELOPER_TOOLS } from 'electron-devtools-installer';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import { join, resolve } from 'path';
import fs from 'fs';
import { ConnectionStatus, IrcMessages, Settings } from '../shared/ipc';
import { BackendClient } from './irc/BackendClient';
import { loadSettings, saveSettings } from './settings';
import { parseIrcUrl } from './ircUrl';

// A packaged build already gets this from electron-builder's own
// `productName` (electron-builder.json5), but that's a packaging-time
// concept Electron itself never reads at runtime - unpackaged (`npm run
// dev`) falls back to package.json's `name`, which is lowercase for the
// npm package itself ("dolq"). Set explicitly, as early as possible per
// Electron's own docs, so the app menu/About panel/Dock say "Dolq" in dev
// too, not just in a packaged build.
app.setName('Dolq');

let mainWindow: BrowserWindow;
let tray: Tray | undefined;

// Set the moment a real quit is actually underway (Cmd+Q, the tray's Quit
// item, or window-all-closed on non-mac) - createWindow's own 'close'
// listener checks this to tell "the user clicked the close button" (hide to
// tray) apart from "the window is closing because the app is quitting" (let
// it). Shares this one flag with before-quit's own idempotency guard below
// rather than inventing a second one - by the time any window's 'close'
// fires during a real quit, before-quit has already run and set it.
let quitting = false;

// An irc(s):// link that arrived (open-url, second-instance, or a cold-
// start argv - see handleIrcUrl/findIrcUrl) before the window's first load
// finished has nowhere to send its prefill yet - queued here, flushed by
// createWindow's 'did-finish-load' listener once there is one.
let pendingIrcUrl: string | null = null;

const ICON_PATH = join(__dirname, '../../resources/icon.png');
// macOS menu bar icons are their own convention, not just a small app icon:
// a black glyph on a transparent background (no colored square, no rounded
// corners), marked as a "template image" so the OS re-tints it for light/
// dark menu bars and the highlighted/clicked state automatically - a
// colorful square there reads as an unpolished Windows-style tray icon, not
// a native Mac one. trayIconTemplate.png/@2x.png (resources/) are a
// generated, transparent-background crop of the dagger from the app icon;
// the "Template" suffix is also Electron/macOS's own filename convention
// for auto-detecting this, on top of the explicit setTemplateImage below.
// Elsewhere, no such convention exists, so this stays the full-color icon.
const TRAY_ICON_PATH = process.platform === 'darwin'
  ? join(__dirname, '../../resources/trayIconTemplate.png')
  : join(__dirname, '../../resources/icons/32x32.png');
const IRC_URL_SCHEMES = ['irc', 'ircs'];

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 2000,
    height: 1080,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#212121',
    icon: ICON_PATH,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Minimize-to-tray: the close ("X"/red traffic light) button hides
  // instead of destroying the window, same as most tray-icon apps - the
  // window (and its scroll position, unsent draft, etc.) survives, and
  // showWindow just un-hides the same instance rather than createWindow
  // building a fresh one. Skipped entirely once a real quit is underway
  // (see `quitting`'s doc), or this would also block Cmd+Q/tray Quit from
  // ever actually closing anything.
  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  // Catches an irc(s):// link that arrived before this load finished (a
  // cold start via the link itself) - see pendingIrcUrl's doc. Left as a
  // persistent listener, not `.once`: flushPendingIrcUrl is already a
  // no-op once the queue is empty, and a real page load (as opposed to
  // just showing/hiding the same one) is the only time this fires again.
  mainWindow.webContents.on('did-finish-load', flushPendingIrcUrl);
}

function showWindow(): void {
  mainWindow.show();
  mainWindow.focus();
}

// findIrcUrl picks the irc(s):// argument out of a process argv list - the
// shape both a Windows/Linux cold-start launch (process.argv) and a
// relaunch caught by 'second-instance' (its own argv) hand over. Unlike
// macOS's open-url event, there's no dedicated event for this on those
// platforms - the OS just launches/relaunches dolq with the link as a
// plain command-line argument instead.
function findIrcUrl(argv: string[]): string | undefined {
  return argv.find((a) => IRC_URL_SCHEMES.some((scheme) => a.startsWith(`${scheme}://`)));
}

// Queues url and, if the window's already done loading, immediately parses
// (see ircUrl.ts) and delivers it - a malformed link (not a well-formed
// irc(s):// URL at all) is logged and dropped rather than ever reaching the
// renderer. Safe to call before mainWindow exists at all (a cold start):
// it just sits in pendingIrcUrl until createWindow's 'did-finish-load'
// listener calls flushPendingIrcUrl itself.
function handleIrcUrl(url: string): void {
  pendingIrcUrl = url;
  flushPendingIrcUrl();
}

function flushPendingIrcUrl(): void {
  if (!pendingIrcUrl || !mainWindow || mainWindow.webContents.isLoadingMainFrame()) return;
  const url = pendingIrcUrl;
  pendingIrcUrl = null;
  const prefill = parseIrcUrl(url);
  if (!prefill) {
    console.error(`ignoring malformed irc(s):// URL: ${url}`);
    return;
  }
  mainWindow.webContents.send(IrcMessages.openIrcUrl, prefill);
  showWindow();
}

// Toggleable from Preferences (Settings.trayEnabled) - not tied to any one
// window's lifetime, so this only ever builds/tears down the Tray object
// itself. The dock badge (setBadgeCount) is independent of whether a tray
// icon exists at all, so that IPC handler is registered separately, always,
// rather than living inside here and silently stopping the moment someone
// turns the tray off.
function createTray(): void {
  if (tray) return;
  const trayIcon = nativeImage.createFromPath(TRAY_ICON_PATH);
  if (process.platform === 'darwin') trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  tray.setToolTip('Dolq');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Dolq', click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  // Right-click already opens the context menu above (setContextMenu's own
  // behavior); a plain click toggles the window the way most tray apps do.
  tray.on('click', () => (mainWindow.isVisible() ? mainWindow.hide() : showWindow()));
}

function destroyTray(): void {
  tray?.destroy();
  tray = undefined;
}

// The dock badge (App.tsx calls this whenever mentionedChannels changes) is
// its own OS-integration feature independent of the tray icon's own on/off
// toggle - registered once, unconditionally, rather than living inside
// createTray() and silently stopping the moment someone turns the tray off.
function registerBadgeCountHandler(): void {
  ipcMain.handle(IrcMessages.setBadgeCount, (_event, count: number) => {
    app.setBadgeCount(count);
  });
}

// Replaces Electron's own default menu (which has no idea Preferences
// exists) with one just like it, plus a "Preferences…" item in the macOS
// app menu - the conventional spot, not the renderer's own gear icon-only
// path. Edit/View/Window/Help stay the default role-based menus (Cut/Copy/
// Paste, DevTools, zoom, etc.) so nothing already working for free is lost
// by taking over the menu at all.
function createAppMenu(): void {
  const openPreferences = () => {
    showWindow();
    mainWindow.webContents.send(IrcMessages.openPreferences);
  };

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { label: 'Preferences…', accelerator: 'Cmd+,', click: openPreferences },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        }]
      : []),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Must be requested before anything else touches app - a second instance
// (e.g. the OS relaunching dolq to open a Windows/Linux irc:// link while
// it's already running - see findIrcUrl) quits immediately here, deferring
// entirely to the 'second-instance' event this fires on the *first*
// instance instead. Everything else in this file only ever runs for that
// first instance - a doomed second one has nothing left to set up.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const url = findIrcUrl(argv);
    if (url) handleIrcUrl(url);
    else showWindow();
  });

  // macOS never launches a second process for this at all - the OS
  // delivers the link straight to the already-running app as this event
  // instead. Registered outside whenReady() (per Electron's own docs)
  // since a cold start via the link can fire this before 'ready' does.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleIrcUrl(url);
  });

  app.whenReady().then(async () => {
    // packaged macOS builds get their Dock icon from icon.icns automatically -
    // this only matters for `npm run frontend:dev`/`electron .`, where macOS would
    // otherwise show the generic Electron icon (BrowserWindow's `icon` option
    // has no effect on macOS, unlike Windows/Linux).
    if (!app.isPackaged) app.dock?.setIcon(ICON_PATH);

    // Windows needs the running script's own path re-supplied in dev (an
    // unpackaged app launches through the bare electron.exe, which
    // otherwise has no idea which project to reopen) - process.defaultApp
    // is Electron's own documented way to tell dev and packaged apart for
    // exactly this, not app.isPackaged (that flag doesn't exist yet this
    // early relative to how this call needs to be made).
    for (const scheme of IRC_URL_SCHEMES) {
      if (process.defaultApp && process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(scheme, process.execPath, [resolve(process.argv[1])]);
      } else {
        app.setAsDefaultProtocolClient(scheme);
      }
    }

    // Loaded before createTray() specifically so a saved trayEnabled: false
    // never flashes a tray icon into existence for a moment at startup only
    // to immediately destroy it again.
    const settings = loadSettings();

    createWindow();
    if (settings.trayEnabled !== false) createTray();
    registerBadgeCountHandler();
    createAppMenu();

    // Windows/Linux cold start via a link: unlike 'second-instance', the
    // very first launch's own argv never fires that event - checked here
    // once, directly. (macOS's equivalent is 'open-url', already listening
    // above regardless of whenReady.)
    const coldStartUrl = findIrcUrl(process.argv);
    if (coldStartUrl) handleIrcUrl(coldStartUrl);

    const backend = new BackendClient(settings.retentionDays);
    // A plain mutable box, not a fresh `settings` binding per read - so
    // registerIrcHandlers' closures see whatever Preferences last saved
    // (registerSettingsHandlers writes into the same box) instead of the
    // value that was current when the app started.
    const settingsBox = { current: settings };
    registerIrcHandlers(mainWindow, backend, settingsBox);
    registerSettingsHandlers(settingsBox);
    registerShellHandlers();
    await installReactDevTools();
    registerAppLifecycleHandlers(backend);
  });
}

// Not IRC-backend traffic at all - shell.openExternal is only reachable
// from the main process, so a clicked link in the renderer (see IrcText)
// has to come through here. Rechecked server-side rather than trusting the
// renderer's own http(s)-only regex as the sole guard.
function registerShellHandlers(): void {
  ipcMain.handle(IrcMessages.openExternal, (_event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`refusing to open non-http(s) link: ${url}`);
    }
    return shell.openExternal(url);
  });

  ipcMain.handle(IrcMessages.saveTextFile, async (_event, defaultName: string, content: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: defaultName });
    if (canceled || !filePath) return false;
    await fs.promises.writeFile(filePath, content, 'utf-8');
    return true;
  });

  ipcMain.handle(IrcMessages.chooseDirectory, async (_event, defaultPath?: string) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      defaultPath, properties: ['openDirectory', 'createDirectory'],
    });
    return canceled || !filePaths[0] ? null : filePaths[0];
  });

  ipcMain.handle(IrcMessages.setZoomFactor, (_event, factor: number) => {
    mainWindow.webContents.setZoomFactor(factor);
  });

  ipcMain.handle(IrcMessages.playAlertSound, () => {
    shell.beep();
  });
}

function registerIrcHandlers(mainWindow: BrowserWindow, backend: BackendClient, settingsBox: { current: Settings }): void {
  ipcMain.handle(
    IrcMessages.connect,
    (
      _event,
      serverId: string,
      host: string,
      port: number,
      nick: string,
      secure: boolean,
      saslUser?: string,
      saslPass?: string,
      username?: string,
      realname?: string,
      altNicks?: string[],
    ) => backend.connect(serverId, host, port, nick, secure, saslUser, saslPass, username, realname, altNicks),
  );

  ipcMain.handle(IrcMessages.send, (_event, serverId: string, message: string) => backend.send(serverId, message));

  ipcMain.handle(IrcMessages.disconnect, (_event, serverId: string) => backend.disconnect(serverId));

  ipcMain.handle(IrcMessages.getStatus, (_event, serverId: string) => backend.getStatus(serverId));

  ipcMain.handle(IrcMessages.getJoinedChannels, (_event, serverId: string) => backend.getJoinedChannels(serverId));

  ipcMain.handle(IrcMessages.getHistory, (_event, serverId: string, channel: string, before?: number, limit?: number) =>
    backend.getHistory(serverId, channel, before, limit),
  );

  ipcMain.handle(IrcMessages.search, (_event, serverId: string, channel: string, query: string, limit?: number) =>
    backend.search(serverId, channel, query, limit),
  );

  ipcMain.handle(IrcMessages.dccOffer, (_event, serverId: string, nick: string) => {
    const { dccPortMin, dccPortMax } = settingsBox.current;
    return backend.dccOffer(serverId, nick, dccPortMin ?? 0, dccPortMax ?? 0);
  });

  ipcMain.handle(IrcMessages.dccAccept, (_event, ip: string, port: number) => backend.dccAccept(ip, port));

  ipcMain.handle(IrcMessages.dccSend, (_event, dccId: string, line: string) => backend.dccSend(dccId, line));

  ipcMain.handle(IrcMessages.dccClose, (_event, dccId: string) => backend.dccClose(dccId));

  ipcMain.handle(
    IrcMessages.xdccAccept,
    (_event, serverId: string, nick: string, ip: string, port: number, filename: string, size: number, token?: string) => {
      const { downloadDir, dccPortMin, dccPortMax } = settingsBox.current;
      return backend.xdccAccept(
        serverId, nick, ip, port, filename, size, token,
        downloadDir || app.getPath('downloads'), dccPortMin ?? 0, dccPortMax ?? 0,
      );
    },
  );

  ipcMain.handle(IrcMessages.xdccClose, (_event, dccId: string) => backend.xdccClose(dccId));

  ipcMain.handle(IrcMessages.xdccPause, (_event, dccId: string) => backend.xdccPause(dccId));

  ipcMain.handle(IrcMessages.xdccResume, (_event, dccId: string) => backend.xdccResume(dccId));

  // The backend already tags every unsolicited frame with the serverId it
  // belongs to, so a single subscription per frame type covers every server
  // - no per-connect listener wiring needed.
  backend.on('line', (serverId: string, line: string) => mainWindow.webContents.send(IrcMessages.line, serverId, line));
  backend.on('event', (serverId: string, event: unknown) => mainWindow.webContents.send(IrcMessages.event, serverId, event));
  backend.on('status', (serverId: string, status: ConnectionStatus) =>
    mainWindow.webContents.send(IrcMessages.status, serverId, status),
  );
}

// Settings live for the process's lifetime in settingsBox.current (shared
// with registerIrcHandlers' closures - see app.whenReady), not re-read from
// disk on every get. saveSettings persists it; retentionDays only actually
// takes effect on the next launch (it's dolqd's launch flag, not something
// it can be told to change mid-run), but downloadDir/dccPortMin/dccPortMax
// apply immediately, since registerIrcHandlers reads them fresh out of this
// same box on every dccOffer/xdccAccept call. trayEnabled applies
// immediately too, the same way - toggling it here is what actually
// creates/destroys the Tray, not just what gets remembered for next launch.
function registerSettingsHandlers(settingsBox: { current: Settings }): void {
  ipcMain.handle(IrcMessages.getSettings, () => settingsBox.current);
  ipcMain.handle(IrcMessages.setSettings, (_event, settings: Settings) => {
    settingsBox.current = settings;
    saveSettings(settings);
    if (settings.trayEnabled === false) destroyTray();
    else createTray();
  });
}

function registerAppLifecycleHandlers(backend: BackendClient): void {
  // The window now survives a close (see createWindow's 'close' listener -
  // it hides instead), so there's always at least one to just re-show;
  // getAllWindows().length === 0 only happens if something else destroyed
  // it outright, same fallback as before this existed.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showWindow();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // dolqd's own shutdown path (bouncer.Shutdown) already PARTs every joined
  // channel and QUITs before exiting, so quitting here is just: stop the
  // backend, then quit. before-quit fires for Cmd+Q, app.quit() (including
  // the tray's own Quit item), and (non-mac) the quit triggered by
  // window-all-closed above - but never from just closing the window
  // anymore, on any platform (see createWindow's 'close' listener). Sets
  // the module-level `quitting` flag that listener checks, so a window
  // close that's actually part of this shutdown is allowed through instead
  // of being redirected to hide().
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    backend.stop().finally(() => app.quit());
  });
}

async function installReactDevTools(): Promise<void> {
  try {
    const ext = await installExtension(REACT_DEVELOPER_TOOLS, { loadExtensionOptions: { allowFileAccess: true } });
    console.log('Added Extension: ', ext.name);
  } catch (err) {
    console.error('Failed to install ${ext.name}', err);
  }
}
