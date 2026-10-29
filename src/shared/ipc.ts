export const IRC_PORT = 6667;
export const IRC_TLS_PORT = 6697;

export type PrivilegeLevel = 'owner' | 'admin' | 'op' | 'halfop' | 'voice' | 'none';

export const PRIVILEGE_RANK: PrivilegeLevel[] = ['owner', 'admin', 'op', 'halfop', 'voice', 'none'];

export function outranks(a: PrivilegeLevel, b: PrivilegeLevel): boolean {
  return PRIVILEGE_RANK.indexOf(a) < PRIVILEGE_RANK.indexOf(b);
}

export function highestPrivilege(privileges: PrivilegeLevel[] | null | undefined): PrivilegeLevel {
  return (privileges ?? []).reduce((best, p) => (outranks(p, best) ? p : best), 'none' as PrivilegeLevel);
}

export type IrcEvent =
  | { type: 'PRIVMSG'; nick: string; target: string; text: string }
  | { type: 'ACTION'; nick: string; target: string; text: string }
  | { type: 'NOTICE'; nick: string; target: string; text: string }
  | { type: 'JOIN'; nick: string; channel: string }
  | { type: 'PART'; nick: string; channel: string; reason?: string }
  | { type: 'KICK'; by: string; channel: string; nick: string; reason?: string }
  | { type: 'QUIT'; nick: string; reason?: string; channels?: string[] }
  | { type: 'NICK'; oldNick: string; newNick: string; channels?: string[] }
  | { type: 'WELCOME'; nick: string }
  | { type: 'NICKINUSE'; nick: string; retrying?: string }
  | { type: 'AWAY'; nick: string; away: boolean; message?: string }
  | { type: 'SELFAWAY'; away: boolean }
  | {
      type: 'MODE';
      by?: string;
      channel: string;
      changes: { nick: string; privilege: Exclude<PrivilegeLevel, 'none'>; granted: boolean }[];
    }
  | { type: 'names'; channel: string; users: { nick: string; privileges: PrivilegeLevel[] }[] }
  | { type: 'TOPIC'; channel: string; topic: string; nick?: string }
  | { type: 'SYSTEM'; channel: string; text: string }
  | { type: 'TOPICWHOTIME'; channel: string; nick: string; setAt: number }
  | {
      type: 'whois';
      nick: string;
      user?: string;
      host?: string;
      realname?: string;
      server?: string;
      serverInfo?: string;
      idleSeconds?: number;
      signonTime?: number;
      channels?: string[];
      account?: string;
      away?: string;
      noSuchNick?: boolean;
    }
  | { type: 'DCCCHATOFFER'; nick: string; ip: string; port: number }
  | { type: 'XDCCPACK'; nick: string; target: string; number: number; gets: number; size: string; filename: string }
  | {
      type: 'XDCCSENDOFFER';
      nick: string;
      filename: string;
      ip: string;
      port: number;
      size: number;
      token?: string;
      host?: string;
      account?: string;
    }
  | {
      type: 'XDCCTRANSFER';
      received: number;
      total: number;
      path: string;
      done?: boolean;
      error?: string;
      // A file going out to someone, not one coming in.
      sending?: boolean;
    };

export type HistoryEntry = {
  id: number;
  serverId: string;
  channel: string;
  timestamp: string;
  isRaw?: boolean;
  line?: string;
  event?: IrcEvent;
};

export type Settings = {
  retentionDays: number;
  downloadDir?: string;
  xdccAutoAccept?: boolean;
  dccPortMin?: number;
  dccPortMax?: number;
  trayEnabled?: boolean;
  remoteEnabled?: boolean;
  remoteUrl?: string;
  // TLS to the remote backend; on unless explicitly false
  remoteTls?: boolean;
  // Self-signed certificate the user accepted (SHA-256, colon-separated hex)
  remoteFingerprint?: string;
  // Write-only: sent to save a new token, never returned by getSettings
  remoteToken?: string;
  remoteTokenSet?: boolean;
};

export type IrcApi = {
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
  ) => Promise<void>;
  secretsAvailable: () => Promise<boolean>;
  rememberSecrets: (
    serverId: string,
    secrets: { password?: string; saslUser?: string; saslPass?: string },
  ) => Promise<boolean>;
  forgetSecrets: (serverId: string) => Promise<void>;
  disconnect: (serverId: string) => Promise<void>;
  sendLine: (serverId: string, line: string) => Promise<void>;
  getStatus: (serverId: string) => Promise<ConnectionStatus>;
  getJoinedChannels: (serverId: string) => Promise<string[]>;
  getHistory: (serverId: string, channel: string, before?: number, limit?: number) => Promise<HistoryEntry[]>;
  search: (serverId: string, channel: string, query: string, limit?: number) => Promise<HistoryEntry[]>;
  getSettings: () => Promise<Settings>;
  setSettings: (settings: Settings) => Promise<void>;
  dccOffer: (serverId: string, nick: string) => Promise<string>;
  dccSendFile: (serverId: string, nick: string, path: string) => Promise<string>;
  chooseFile: () => Promise<string | null>;
  dccAccept: (ip: string, port: number) => Promise<string>;
  dccSend: (dccId: string, line: string) => Promise<void>;
  dccClose: (dccId: string) => Promise<void>;
  xdccAccept: (
    serverId: string,
    nick: string,
    ip: string,
    port: number,
    filename: string,
    size: number,
    token?: string,
  ) => Promise<string>;
  xdccClose: (xdccId: string) => Promise<void>;
  xdccPause: (xdccId: string) => Promise<void>;
  xdccResume: (xdccId: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  showInFolder: (path: string) => Promise<void>;
  setTitleBar: (color: string, symbolColor: string) => Promise<void>;
  saveTextFile: (defaultName: string, content: string) => Promise<boolean>;
  chooseDirectory: (defaultPath?: string) => Promise<string | null>;
  setBadgeCount: (count: number) => Promise<void>;
  setZoomFactor: (factor: number) => Promise<void>;
  playAlertSound: () => Promise<void>;
  onLine: (callback: (serverId: string, line: string) => void) => () => void;
  onEvent: (callback: (serverId: string, event: IrcEvent) => void) => () => void;
  onStatus: (callback: (serverId: string, status: ConnectionStatus) => void) => () => void;
  onOpenIrcUrl: (
    callback: (prefill: { host: string; port: number; secure: boolean; channel?: string }) => void,
  ) => () => void;
  onOpenPreferences: (callback: () => void) => () => void;
  // The connection to a remote backend dropped and came back; its sessions
  // may have changed meanwhile.
  onBackendReconnected: (callback: () => void) => () => void;
};

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

export enum IrcMessages {
  connect = 'irc:connect',
  disconnect = 'irc:disconnect',
  send = 'irc:send',
  getStatus = 'irc:getStatus',
  getJoinedChannels = 'irc:getJoinedChannels',
  getHistory = 'irc:getHistory',
  search = 'irc:search',
  getSettings = 'irc:getSettings',
  setSettings = 'irc:setSettings',
  dccOffer = 'irc:dccOffer',
  dccSendFile = 'irc:dccSendFile',
  chooseFile = 'irc:chooseFile',
  dccAccept = 'irc:dccAccept',
  dccSend = 'irc:dccSend',
  dccClose = 'irc:dccClose',
  xdccAccept = 'irc:xdccAccept',
  xdccClose = 'irc:xdccClose',
  xdccPause = 'irc:xdccPause',
  xdccResume = 'irc:xdccResume',
  openExternal = 'irc:openExternal',
  showInFolder = 'irc:showInFolder',
  setTitleBar = 'irc:setTitleBar',
  saveTextFile = 'irc:saveTextFile',
  chooseDirectory = 'irc:chooseDirectory',
  setBadgeCount = 'irc:setBadgeCount',
  setZoomFactor = 'irc:setZoomFactor',
  playAlertSound = 'irc:playAlertSound',
  line = 'irc:line',
  event = 'irc:event',
  status = 'irc:status',
  openIrcUrl = 'irc:openIrcUrl',
  openPreferences = 'irc:openPreferences',
  backendReconnected = 'irc:backendReconnected',
  secretsAvailable = 'secrets:available',
  secretsRemember = 'secrets:remember',
  secretsForget = 'secrets:forget',
}
