import { installExtension, REACT_DEVELOPER_TOOLS } from 'electron-devtools-installer';
import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { ConnectionStatus, IrcMessages } from '../shared/ipc';
import { BackendClient } from './irc/BackendClient';

let mainWindow: BrowserWindow;

const ICON_PATH = join(__dirname, '../../resources/icon.png');

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
}

app.whenReady().then(async () => {
  // packaged macOS builds get their Dock icon from icon.icns automatically -
  // this only matters for `npm run dev`/`electron .`, where macOS would
  // otherwise show the generic Electron icon (BrowserWindow's `icon` option
  // has no effect on macOS, unlike Windows/Linux).
  if (!app.isPackaged) app.dock?.setIcon(ICON_PATH);
  createWindow();

  const backend = new BackendClient();
  registerIrcHandlers(mainWindow, backend);
  await installReactDevTools();
  registerAppLifecycleHandlers(backend);
});

function registerIrcHandlers(mainWindow: BrowserWindow, backend: BackendClient): void {
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
    ) => backend.connect(serverId, host, port, nick, secure, saslUser, saslPass),
  );

  ipcMain.handle(IrcMessages.send, (_event, serverId: string, message: string) => backend.send(serverId, message));

  ipcMain.handle(IrcMessages.disconnect, (_event, serverId: string) => backend.disconnect(serverId));

  ipcMain.handle(IrcMessages.getStatus, (_event, serverId: string) => backend.getStatus(serverId));

  ipcMain.handle(IrcMessages.getJoinedChannels, (_event, serverId: string) => backend.getJoinedChannels(serverId));

  ipcMain.handle(IrcMessages.getHistory, (_event, serverId: string, channel: string, before?: number, limit?: number) =>
    backend.getHistory(serverId, channel, before, limit),
  );

  // The backend already tags every unsolicited frame with the serverId it
  // belongs to, so a single subscription per frame type covers every server
  // - no per-connect listener wiring needed.
  backend.on('line', (serverId: string, line: string) => mainWindow.webContents.send(IrcMessages.line, serverId, line));
  backend.on('event', (serverId: string, event: unknown) => mainWindow.webContents.send(IrcMessages.event, serverId, event));
  backend.on('status', (serverId: string, status: ConnectionStatus) =>
    mainWindow.webContents.send(IrcMessages.status, serverId, status),
  );
}

function registerAppLifecycleHandlers(backend: BackendClient): void {
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // dolqd's own shutdown path (bouncer.Shutdown) already PARTs every joined
  // channel and QUITs before exiting, so quitting here is just: stop the
  // backend, then quit. before-quit fires for Cmd+Q, app.quit(), and
  // (non-mac) the quit triggered by window-all-closed above - but not for a
  // mac user just closing the window, since the app and its connections are
  // still alive in that case.
  let quitting = false;
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
