// Standard IRC ports: plaintext and implicit TLS.
export const IRC_PORT = 6667;
export const IRC_TLS_PORT = 6697;

// Ranked highest to lowest; 'none' means no channel privilege.
export type PrivilegeLevel = 'owner' | 'admin' | 'op' | 'halfop' | 'voice' | 'none';

export const PRIVILEGE_RANK: PrivilegeLevel[] = ['owner', 'admin', 'op', 'halfop', 'voice', 'none'];

// True if `a` is a strictly higher privilege than `b`.
export function outranks(a: PrivilegeLevel, b: PrivilegeLevel): boolean {
  return PRIVILEGE_RANK.indexOf(a) < PRIVILEGE_RANK.indexOf(b);
}

// The best-ranked privilege in a set - what a badge/group-by-rank display
// wants, now that `multi-prefix` means a user's full set of channel
// privileges is tracked, not just the one the server used to lead with.
export function highestPrivilege(privileges: PrivilegeLevel[]): PrivilegeLevel {
  return privileges.reduce((best, p) => (outranks(p, best) ? p : best), 'none' as PrivilegeLevel);
}

export type IrcEvent =
  | { type: 'PRIVMSG'; nick: string; target: string; text: string }
  | { type: 'ACTION'; nick: string; target: string; text: string }
  | { type: 'NOTICE'; nick: string; target: string; text: string }
  | { type: 'JOIN'; nick: string; channel: string }
  | { type: 'PART'; nick: string; channel: string; reason?: string }
  | { type: 'KICK'; by: string; channel: string; nick: string; reason?: string }
  | { type: 'QUIT'; nick: string; reason?: string }
  | { type: 'NICK'; oldNick: string; newNick: string }
  | { type: 'WELCOME'; nick: string }
  | { type: 'NICKINUSE'; nick: string; retrying?: string }
  | {
      type: 'MODE';
      channel: string;
      changes: { nick: string; privilege: Exclude<PrivilegeLevel, 'none'>; granted: boolean }[];
    }
  | { type: 'names'; channel: string; users: { nick: string; privileges: PrivilegeLevel[] }[] }
  | { type: 'TOPIC'; channel: string; topic: string; nick?: string }
  | { type: 'TOPICWHOTIME'; channel: string; nick: string; setAt: number };

// One persisted line, as returned by getHistory - mirrors
// backend/internal/history.Entry's JSON shape: everything that flowed
// through the backend gets stored verbatim (raw line, or the same IrcEvent
// shape onEvent already delivers live), not just what today's UI renders.
// serverId/channel aren't included: a getHistory response is already scoped
// to the request.
export type HistoryEntry = {
  id: number;
  timestamp: string; // RFC3339; caller converts with `new Date(...)`
  isRaw?: boolean;
  line?: string; // present when isRaw
  event?: IrcEvent; // present when !isRaw
};

// Settings that persist independent of any one server - unlike everything
// else in this file, these are read by the main process before dolqd is
// even spawned (retentionDays becomes its `-retention-days` launch flag),
// so they live in their own small file rather than the renderer's
// localStorage-backed zustand store (see src/main/settings.ts).
export type Settings = {
  // Prune history older than this many days; 0 keeps it forever (dolqd's
  // own default). Takes effect on the next launch, not live - it's a launch
  // flag, not something dolqd can be told to change mid-run.
  retentionDays: number;
};

export type IrcApi = {
  // saslUser/saslPass are optional; both empty/omitted skips SASL PLAIN
  // entirely and connects the same way it always did. username/realname
  // empty default to nick/"Dolq IRC Client"; altNicks empty just means the
  // usual underscore-appending nick-collision fallback, nothing configured
  // ahead of it.
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
  ) => Promise<void>;
  disconnect: (serverId: string) => Promise<void>;
  sendLine: (serverId: string, line: string) => Promise<void>;
  getStatus: (serverId: string) => Promise<ConnectionStatus>;
  getJoinedChannels: (serverId: string) => Promise<string[]>;
  getHistory: (serverId: string, channel: string, before?: number, limit?: number) => Promise<HistoryEntry[]>;
  getSettings: () => Promise<Settings>;
  setSettings: (settings: Settings) => Promise<void>;
  onLine: (callback: (serverId: string, line: string) => void) => () => void;
  onEvent: (callback: (serverId: string, event: IrcEvent) => void) => () => void;
  onStatus: (callback: (serverId: string, status: ConnectionStatus) => void) => () => void;
};

// 'connecting' covers both a fresh manual connect and the backend
// auto-retrying after an unexpected drop - the frontend doesn't need to
// tell those apart, see ROADMAP's "Auto-reconnect with backoff".
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

export enum IrcMessages {
  connect = 'irc:connect',
  disconnect = 'irc:disconnect',
  send = 'irc:send',
  getStatus = 'irc:getStatus',
  getJoinedChannels = 'irc:getJoinedChannels',
  getHistory = 'irc:getHistory',
  getSettings = 'irc:getSettings',
  setSettings = 'irc:setSettings',
  line = 'irc:line',
  event = 'irc:event',
  status = 'irc:status',
}
