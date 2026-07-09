export type IrcEvent =
  | { type: 'PRIVMSG'; nick: string; target: string; text: string }
  | { type: 'JOIN'; nick: string; channel: string }
  | { type: 'PART'; nick: string; channel: string; reason?: string }
  | { type: 'QUIT'; nick: string; reason?: string }
  | { type: 'NICK'; oldNick: string; newNick: string }
  | { type: 'names'; channel: string; users: { nick: string; isOp: boolean }[] };

export type IrcApi = {
  connect: (serverId: string, host: string, port: number, nick: string) => Promise<void>;
  disconnect: (serverId: string) => Promise<void>;
  sendLine: (serverId: string, line: string) => Promise<void>;
  onLine: (callback: (serverId: string, line: string) => void) => () => void;
  onEvent: (callback: (serverId: string, event: IrcEvent) => void) => () => void;
  onStatus: (callback: (serverId: string, status: 'connected' | 'disconnected') => void) => () => void;
};

export enum IrcMessages {
  connect = 'irc:connect',
  disconnect = 'irc:disconnect',
  send = 'irc:send',
  line = 'irc:line',
  event = 'irc:event',
  status = 'irc:status',
}
