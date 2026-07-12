import { installExtension, REACT_DEVELOPER_TOOLS } from 'electron-devtools-installer';
import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { IrcMessages } from '../shared/ipc';
import { IrcClient } from './irc/client';

let mainWindow: BrowserWindow;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 2000,
    height: 1080,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#36393f',
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
  createWindow();
  registerIrcHandlers(mainWindow);
  await installReactDevTools();
  registerAppLifecycleHandlers();
});

function registerIrcHandlers(mainWindow: BrowserWindow): void {
  const clients = new Map<string, IrcClient>();

  ipcMain.handle(IrcMessages.connect, async (_event, serverId: string, host: string, port: number, nick: string) => {
    await clients.get(serverId)?.disconnect();

    const client = new IrcClient(host, port, nick);
    clients.set(serverId, client);
    client.connect();
    client.addLineListener((line) => {
      mainWindow.webContents.send(IrcMessages.line, serverId, line);
    });
    client.addEventListener((event) => {
      mainWindow.webContents.send(IrcMessages.event, serverId, event);
    });
    client.onClose(() => {
      clients.delete(serverId);
      mainWindow.webContents.send(IrcMessages.status, serverId, 'disconnected');
    });
  });

  ipcMain.handle(IrcMessages.send, async (_event, serverId: string, message: string) => {
    await clients.get(serverId)?.send(message);
  });

  ipcMain.handle(IrcMessages.disconnect, async (_event, serverId: string) => {
    await clients.get(serverId)?.disconnect();
  });

  // Lets a freshly (re)loaded renderer reconcile its optimistic, unpersisted
  // statusMap against the connections actually still alive in this process -
  // e.g. after a dev-mode renderer-only reload that didn't restart `clients`.
  ipcMain.handle(IrcMessages.getStatus, (_event, serverId: string) => {
    return clients.has(serverId) ? 'connected' : 'disconnected';
  });
}

function registerAppLifecycleHandlers(): void {
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
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
