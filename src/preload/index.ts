import { contextBridge, ipcRenderer } from 'electron';
import { ConnectionStatus, IrcApi, IrcEvent, IrcMessages, Settings } from '../shared/ipc';

contextBridge.exposeInMainWorld('irc', {
  connect: (
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
  ) =>
    ipcRenderer.invoke(
      IrcMessages.connect, serverId, host, port, nick, secure, saslUser, saslPass, username, realname, altNicks,
    ),

  sendLine: (serverId: string, line: string) =>
    ipcRenderer.invoke(IrcMessages.send, serverId, line),

  disconnect: (serverId: string) =>
    ipcRenderer.invoke(IrcMessages.disconnect, serverId),

  getStatus: (serverId: string) =>
    ipcRenderer.invoke(IrcMessages.getStatus, serverId),

  getJoinedChannels: (serverId: string) =>
    ipcRenderer.invoke(IrcMessages.getJoinedChannels, serverId),

  getHistory: (serverId: string, channel: string, before?: number, limit?: number) =>
    ipcRenderer.invoke(IrcMessages.getHistory, serverId, channel, before, limit),

  getSettings: () => ipcRenderer.invoke(IrcMessages.getSettings),

  setSettings: (settings: Settings) => ipcRenderer.invoke(IrcMessages.setSettings, settings),

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
    const handler = (_event: Electron.IpcRendererEvent, serverId: string, status: ConnectionStatus) =>
      callback(serverId, status);
    ipcRenderer.on(IrcMessages.status, handler);
    return () => ipcRenderer.removeListener(IrcMessages.status, handler);
  },
} satisfies IrcApi);
