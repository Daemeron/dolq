import { contextBridge, ipcRenderer } from 'electron';
import { IrcApi, IrcEvent, IrcMessages } from '../shared/ipc';

contextBridge.exposeInMainWorld('irc', {
  connect: (serverId: string, host: string, port: number, nick: string) =>
    ipcRenderer.invoke(IrcMessages.connect, serverId, host, port, nick),

  sendLine: (serverId: string, line: string) =>
    ipcRenderer.invoke(IrcMessages.send, serverId, line),

  disconnect: (serverId: string) =>
    ipcRenderer.invoke(IrcMessages.disconnect, serverId),

  getStatus: (serverId: string) =>
    ipcRenderer.invoke(IrcMessages.getStatus, serverId),

  getJoinedChannels: (serverId: string) =>
    ipcRenderer.invoke(IrcMessages.getJoinedChannels, serverId),

  onLine: (callback: (serverId: string, line: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, serverId: string, line: string) => callback(serverId, line);
    ipcRenderer.on(IrcMessages.line, handler);
    return () => ipcRenderer.removeListener(IrcMessages.line, handler);
  },

  onEvent: (callback: (serverId: string, event: IrcEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, serverId: string, ircEvent: IrcEvent) =>
      callback(serverId, ircEvent);
    ipcRenderer.on(IrcMessages.event, handler);
    return () => ipcRenderer.removeListener(IrcMessages.event, handler);
  },

  onStatus: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, serverId: string, status: 'connected' | 'disconnected') =>
      callback(serverId, status);
    ipcRenderer.on(IrcMessages.status, handler);
    return () => ipcRenderer.removeListener(IrcMessages.status, handler);
  },
} satisfies IrcApi);
