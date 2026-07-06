export type IrcApi = {
  connect: (host: string, port: number, nick: string) => Promise<void>;
  disconnect: () => Promise<void>;
  sendLine: (line: string) => Promise<void>;
  onLine: (callback: (line: string) => void) => () => void;
  onStatus: (callback: (status: 'connected' | 'disconnected') => void) => () => void;
};

export enum IrcMessages {
  connect = 'irc:connect',
  disconnect = 'irc:disconnect',
  send = 'irc:send',
  line = 'irc:line',
  status = 'irc:status',
}
