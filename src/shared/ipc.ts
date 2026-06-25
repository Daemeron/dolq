// Ranked highest to lowest; 'none' means no channel privilege.
export type PrivilegeLevel = 'owner' | 'admin' | 'op' | 'halfop' | 'voice' | 'none';

export const PRIVILEGE_RANK: PrivilegeLevel[] = ['owner', 'admin', 'op', 'halfop', 'voice', 'none'];

// True if `a` is a strictly higher privilege than `b`.
export function outranks(a: PrivilegeLevel, b: PrivilegeLevel): boolean {
  return PRIVILEGE_RANK.indexOf(a) < PRIVILEGE_RANK.indexOf(b);
}

export type IrcEvent =
  | { type: 'PRIVMSG'; nick: string; target: string; text: string }
  | { type: 'JOIN'; nick: string; channel: string }
  | { type: 'PART'; nick: string; channel: string; reason?: string }
  | { type: 'QUIT'; nick: string; reason?: string }
  | { type: 'NICK'; oldNick: string; newNick: string }
  | {
      type: 'MODE';
      channel: string;
      changes: { nick: string; privilege: Exclude<PrivilegeLevel, 'none'>; granted: boolean }[];
    }
  | { type: 'names'; channel: string; users: { nick: string; privilege: PrivilegeLevel }[] };

export type IrcApi = {
  connect: (serverId: string, host: string, port: number, nick: string) => Promise<void>;
  disconnect: (serverId: string) => Promise<void>;
  sendLine: (serverId: string, line: string) => Promise<void>;
  getStatus: (serverId: string) => Promise<'connected' | 'disconnected'>;
  onLine: (callback: (serverId: string, line: string) => void) => () => void;
  onEvent: (callback: (serverId: string, event: IrcEvent) => void) => () => void;
  onStatus: (callback: (serverId: string, status: 'connected' | 'disconnected') => void) => () => void;
};

export enum IrcMessages {
  connect = 'irc:connect',
  disconnect = 'irc:disconnect',
  send = 'irc:send',
  getStatus = 'irc:getStatus',
  line = 'irc:line',
  event = 'irc:event',
  status = 'irc:status',
}
