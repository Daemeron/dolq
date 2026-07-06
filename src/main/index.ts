import { installExtension, REACT_DEVELOPER_TOOLS } from 'electron-devtools-installer';
import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { IrcMessages } from '../shared/ipc';
import { IrcClient } from './irc/client';

let mainWindow: BrowserWindow;
let ircClient: IrcClient | null = null;

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
  try {
    const ext = await installExtension(REACT_DEVELOPER_TOOLS, { loadExtensionOptions: { allowFileAccess: true } });
    console.log('Added Extension: ', ext.name);
  } catch (err) {
    console.error('Failed to install ${ext.name}', err);
  }

  ipcMain.handle(IrcMessages.connect, (_event, host: string, port: number, nick: string) => {
    if (ircClient) {
      ircClient.disconnect();
      ircClient = null;
    }

    ircClient = new IrcClient(host, port, nick);
    ircClient.connect();
    ircClient.addLineListener((line) => {
      mainWindow.webContents.send(IrcMessages.line, line);
    });
    ircClient.onClose(() => {
      ircClient = null;
      mainWindow.webContents.send(IrcMessages.status, 'disconnected');
    });
  });

  ipcMain.handle(IrcMessages.send, async (_event, message: string) => {
    if (!ircClient) return;
    await ircClient.send(message);
  });

  ipcMain.handle(IrcMessages.disconnect, () => {
    if (!ircClient) return;
    ircClient.disconnect();
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });


});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
