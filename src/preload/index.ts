import { contextBridge, ipcRenderer } from 'electron';
import {
  type ConnectionStatus,
  type IrcApi,
  type IrcEvent,
  IrcMessages,
  type Settings,
  type UpdateStatus,
} from '../shared/ipc';

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
    password?: string,
  ) =>
    ipcRenderer.invoke(
      IrcMessages.connect,
      serverId,
      host,
      port,
      nick,
      secure,
      saslUser,
      saslPass,
      username,
      realname,
      altNicks,
      password,
    ),

  // every caller is fire-and-forget; a failed send (backend down) has nowhere better to go than the log
  sendLine: (serverId: string, line: string) =>
    ipcRenderer.invoke(IrcMessages.send, serverId, line).catch((err) => console.error('send failed:', err)),

  secretsAvailable: () => ipcRenderer.invoke(IrcMessages.secretsAvailable),

  rememberSecrets: (serverId: string, secrets: { password?: string; saslUser?: string; saslPass?: string }) =>
    ipcRenderer.invoke(IrcMessages.secretsRemember, serverId, secrets),

  forgetSecrets: (serverId: string) => ipcRenderer.invoke(IrcMessages.secretsForget, serverId),

  disconnect: (serverId: string) => ipcRenderer.invoke(IrcMessages.disconnect, serverId),

  getStatus: (serverId: string) => ipcRenderer.invoke(IrcMessages.getStatus, serverId),

  getJoinedChannels: (serverId: string) => ipcRenderer.invoke(IrcMessages.getJoinedChannels, serverId),

  getHistory: (serverId: string, channel: string, before?: number, limit?: number) =>
    ipcRenderer.invoke(IrcMessages.getHistory, serverId, channel, before, limit),

  search: (serverId: string, channel: string, query: string, limit?: number) =>
    ipcRenderer.invoke(IrcMessages.search, serverId, channel, query, limit),

  getSettings: () => ipcRenderer.invoke(IrcMessages.getSettings),

  setSettings: (settings: Settings) => ipcRenderer.invoke(IrcMessages.setSettings, settings),

  dccOffer: (serverId: string, nick: string) => ipcRenderer.invoke(IrcMessages.dccOffer, serverId, nick),
  dccSendFile: (serverId: string, nick: string, path: string) =>
    ipcRenderer.invoke(IrcMessages.dccSendFile, serverId, nick, path),
  chooseFile: () => ipcRenderer.invoke(IrcMessages.chooseFile),

  dccAccept: (ip: string, port: number) => ipcRenderer.invoke(IrcMessages.dccAccept, ip, port),

  dccSend: (dccId: string, line: string) => ipcRenderer.invoke(IrcMessages.dccSend, dccId, line),

  dccClose: (dccId: string) => ipcRenderer.invoke(IrcMessages.dccClose, dccId),

  xdccAccept: (
    serverId: string,
    nick: string,
    ip: string,
    port: number,
    filename: string,
    size: number,
    token?: string,
  ) => ipcRenderer.invoke(IrcMessages.xdccAccept, serverId, nick, ip, port, filename, size, token),

  xdccClose: (xdccId: string) => ipcRenderer.invoke(IrcMessages.xdccClose, xdccId),

  xdccPause: (xdccId: string) => ipcRenderer.invoke(IrcMessages.xdccPause, xdccId),

  xdccResume: (xdccId: string) => ipcRenderer.invoke(IrcMessages.xdccResume, xdccId),

  openExternal: (url: string) => ipcRenderer.invoke(IrcMessages.openExternal, url),
  showInFolder: (path: string) => ipcRenderer.invoke(IrcMessages.showInFolder, path),
  setTitleBar: (color: string, symbolColor: string) => ipcRenderer.invoke(IrcMessages.setTitleBar, color, symbolColor),

  saveTextFile: (defaultName: string, content: string) =>
    ipcRenderer.invoke(IrcMessages.saveTextFile, defaultName, content),

  chooseDirectory: (defaultPath?: string) => ipcRenderer.invoke(IrcMessages.chooseDirectory, defaultPath),

  setBadgeCount: (count: number) => ipcRenderer.invoke(IrcMessages.setBadgeCount, count),

  setZoomFactor: (factor: number) => ipcRenderer.invoke(IrcMessages.setZoomFactor, factor),

  playAlertSound: () => ipcRenderer.invoke(IrcMessages.playAlertSound),

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

  onOpenIrcUrl: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      prefill: { host: string; port: number; secure: boolean; channel?: string },
    ) => callback(prefill);
    ipcRenderer.on(IrcMessages.openIrcUrl, handler);
    return () => ipcRenderer.removeListener(IrcMessages.openIrcUrl, handler);
  },

  onOpenPreferences: (callback) => {
    const handler = () => callback();
    ipcRenderer.on(IrcMessages.openPreferences, handler);
    return () => ipcRenderer.removeListener(IrcMessages.openPreferences, handler);
  },

  appReady: () => ipcRenderer.invoke(IrcMessages.appReady),

  getUpdateStatus: () => ipcRenderer.invoke(IrcMessages.getUpdateStatus),

  downloadUpdate: () => ipcRenderer.invoke(IrcMessages.downloadUpdate),

  installUpdate: () => ipcRenderer.invoke(IrcMessages.installUpdate),

  onUpdateStatus: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => callback(status);
    ipcRenderer.on(IrcMessages.updateStatus, handler);
    return () => ipcRenderer.removeListener(IrcMessages.updateStatus, handler);
  },

  onBackendReconnected: (callback) => {
    const handler = () => callback();
    ipcRenderer.on(IrcMessages.backendReconnected, handler);
    return () => ipcRenderer.removeListener(IrcMessages.backendReconnected, handler);
  },
} satisfies IrcApi);
