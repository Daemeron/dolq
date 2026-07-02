import { contextBridge, ipcRenderer } from 'electron';
import { IrcApi, IrcMessages } from '../shared/ipc';

contextBridge.exposeInMainWorld('irc', {
  connect: (host: string, port: number, nick: string) =>
    ipcRenderer.invoke(IrcMessages.connect, host, port, nick),

  sendLine: (line: string) =>
    ipcRenderer.invoke(IrcMessages.send, line),

  disconnect: () =>
    ipcRenderer.invoke(IrcMessages.disconnect),

  onLine: (callback: (line: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, line: string) => callback(line);
    ipcRenderer.on(IrcMessages.line, handler);
    return () => ipcRenderer.removeListener(IrcMessages.line, handler);
  },
} satisfies IrcApi);
