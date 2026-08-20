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
//
// `privileges` comes off the wire (an IPC frame the Go backend sent) - the
// TS type is only a compile-time promise, not a runtime guarantee, and a
// backend nil-slice-marshals-to-null slip already crashed every caller of
// this by reaching in with `null` once (see ircparse.parseNames). Guarding
// here, the one place every caller already routes through, is cheaper than
// hoping every future caller remembers to.
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
  | { type: 'QUIT'; nick: string; reason?: string }
  | { type: 'NICK'; oldNick: string; newNick: string }
  | { type: 'WELCOME'; nick: string }
  | { type: 'NICKINUSE'; nick: string; retrying?: string }
  // A real-time away-notify update (message only meaningful when away is
  // true - "back" carries none) or a one-shot "they're away" learned from
  // messaging someone (see backend/internal/ircparse.AwayEvent's doc).
  | { type: 'AWAY'; nick: string; away: boolean; message?: string }
  // The server confirming our own AWAY command took effect.
  | { type: 'SELFAWAY'; away: boolean }
  | {
      type: 'MODE';
      channel: string;
      changes: { nick: string; privilege: Exclude<PrivilegeLevel, 'none'>; granted: boolean }[];
    }
  | { type: 'names'; channel: string; users: { nick: string; privileges: PrivilegeLevel[] }[] }
  | { type: 'TOPIC'; channel: string; topic: string; nick?: string }
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
  // One row of an XDCC bot's pack listing, recognized inside an ordinary
  // NOTICE/PRIVMSG's text - see backend/internal/xdcc. Delivered alongside
  // that underlying NOTICE/PRIVMSG event, not instead of it.
  | { type: 'XDCCPACK'; nick: string; target: string; number: number; gets: number; size: string; filename: string }
  // A parsed CTCP "DCC SEND" request - a bot answering "XDCC SEND #n" with
  // an offer to actually send the file. Port 0 means passive/reverse (see
  // backend/internal/ircparse.XDCCSendOfferEvent); accepting either shape
  // is xdccAccept, same "explicit user decision" as DCCCHATOFFER.
  | { type: 'XDCCSENDOFFER'; nick: string; filename: string; ip: string; port: number; size: number; token?: string }
  // Progress on a transfer xdccAccept started, delivered under that call's
  // own id the same way DCC CHAT's status is (see dccAccept's doc) - not a
  // real serverId.
  | { type: 'XDCCTRANSFER'; received: number; total: number; path: string; done?: boolean; error?: string };

// One persisted line, as returned by getHistory/search - mirrors
// backend/internal/history.Entry's JSON shape: everything that flowed
// through the backend gets stored verbatim (raw line, or the same IrcEvent
// shape onEvent already delivers live), not just what today's UI renders.
// serverId/channel are always present on the wire (a search can span more
// than one of either, so results have to say where they came from) - just
// redundant, not wrong, for a getHistory response already scoped to one.
export type HistoryEntry = {
  id: number;
  serverId: string;
  channel: string;
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
  // Where xdccAccept saves finished downloads - empty/undefined defaults to
  // the OS Downloads folder, resolved in main (see registerIrcHandlers).
  // Unlike retentionDays, this applies immediately: it's read fresh out of
  // Settings on every xdccAccept call, not baked into a launch flag.
  downloadDir?: string;
  // Constrains the port dccOffer/xdccAccept's passive branch listen on -
  // both empty/0 (the default) lets the OS pick any free one, same as
  // before this existed. A fixed range is what a user behind NAT actually
  // forwards in their router; a random OS-chosen port can't be forwarded
  // ahead of time. Same "read fresh on every call" immediacy as downloadDir.
  dccPortMin?: number;
  dccPortMax?: number;
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
  // Both serverId and channel empty/omitted widens the search - see
  // backend/internal/history.Store.Search's doc for exactly how.
  search: (serverId: string, channel: string, query: string, limit?: number) => Promise<HistoryEntry[]>;
  getSettings: () => Promise<Settings>;
  setSettings: (settings: Settings) => Promise<void>;
  // DCC CHAT (see backend/internal/bouncer/dcc.go). Both offer and accept
  // return a session id that lines/status for that session arrive under -
  // onLine/onStatus below are already generic over "some id", DCC sessions
  // just aren't real serverIds.
  dccOffer: (serverId: string, nick: string) => Promise<string>;
  dccAccept: (ip: string, port: number) => Promise<string>;
  dccSend: (dccId: string, line: string) => Promise<void>;
  dccClose: (dccId: string) => Promise<void>;
  // Accepts a DCC SEND offer (see XDCCSENDOFFER) and downloads it into the
  // OS Downloads folder (main resolves that, not the renderer - fs isn't
  // reachable from here either); the returned id is where XDCCTRANSFER
  // progress and connecting/connected/disconnected status arrive under,
  // same "some id" genericity as a DCC CHAT session's.
  xdccAccept: (
    serverId: string, nick: string, ip: string, port: number, filename: string, size: number, token?: string,
  ) => Promise<string>;
  xdccClose: (xdccId: string) => Promise<void>;
  // Pause/resume an in-progress transfer in place - see
  // backend/internal/dcc.PauseGate. Rejects if xdccId is unknown (already
  // finished/closed), unlike xdccClose's quieter no-op.
  xdccPause: (xdccId: string) => Promise<void>;
  xdccResume: (xdccId: string) => Promise<void>;
  // Opens url in the OS's default browser (Electron's shell.openExternal) -
  // not something the renderer can do directly (no direct Node/Electron API
  // access, by design). Rejects for anything that isn't http(s) - see
  // IrcText, which only ever recognizes http(s) links to begin with, and
  // main/index.ts's handler, which checks again rather than trusting the
  // renderer's own regex as the only guard.
  openExternal: (url: string) => Promise<void>;
  // Prompts a native save dialog (defaultName pre-filled) and writes content
  // to wherever the user picks - fs isn't reachable from the renderer
  // either. Resolves false (not rejects) if the user cancels the dialog.
  saveTextFile: (defaultName: string, content: string) => Promise<boolean>;
  // Prompts a native directory picker (Preferences' download-directory
  // field) - resolves null, not rejects, if the user cancels.
  chooseDirectory: (defaultPath?: string) => Promise<string | null>;
  // Reflects unread-mention count on the dock icon (app.setBadgeCount) -
  // macOS and Linux (Unity) only, a silent no-op elsewhere (Windows needs a
  // taskbar overlay icon instead, a different API - not implemented, same
  // "unverified beyond macOS" gap ROADMAP's Windows/Linux parity item
  // already tracks). Called from App.tsx whenever mentionedChannels changes.
  setBadgeCount: (count: number) => Promise<void>;
  // Whole-window Chromium page zoom (Preferences' font size) - scales text
  // *and* layout uniformly, same as a browser's own Cmd/Ctrl +/-. Not a
  // renderer-side CSS change: most of this app's text sizes are fixed
  // Tailwind px values, not rem/em, so nothing here would visibly respond
  // to a root font-size otherwise.
  setZoomFactor: (factor: number) => Promise<void>;
  // Preferences' sound alerts: the OS's own system alert sound
  // (Electron's shell.beep(), a thin native passthrough - not a bundled
  // audio asset or a synthesized tone, both unnecessary when the platform
  // already has one users can already control/replace at the OS level).
  // A silent no-op on a Linux desktop with no sound daemon configured,
  // same "some platforms don't do the thing" shape as setBadgeCount.
  playAlertSound: () => Promise<void>;
  onLine: (callback: (serverId: string, line: string) => void) => () => void;
  onEvent: (callback: (serverId: string, event: IrcEvent) => void) => () => void;
  onStatus: (callback: (serverId: string, status: ConnectionStatus) => void) => () => void;
  // Fires when the OS hands dolq an irc(s):// link to open (registered as
  // its protocol handler - see main/index.ts's registerIrcUrlHandlers and
  // main/ircUrl.ts's parseIrcUrl) - host/port/secure/channel prefill the
  // "Add a Server" form the same shape a picked preset already does.
  onOpenIrcUrl: (callback: (prefill: { host: string; port: number; secure: boolean; channel?: string }) => void) => () => void;
  // Fires from the macOS app menu's "Dolq > Preferences…" item (Cmd+,) -
  // the menu itself lives in main/index.ts (Electron menus are main-process
  // only), so opening the modal has to cross back over into the renderer
  // the same way an irc(s):// link's prefill already does.
  onOpenPreferences: (callback: () => void) => () => void;
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
  search = 'irc:search',
  getSettings = 'irc:getSettings',
  setSettings = 'irc:setSettings',
  dccOffer = 'irc:dccOffer',
  dccAccept = 'irc:dccAccept',
  dccSend = 'irc:dccSend',
  dccClose = 'irc:dccClose',
  xdccAccept = 'irc:xdccAccept',
  xdccClose = 'irc:xdccClose',
  xdccPause = 'irc:xdccPause',
  xdccResume = 'irc:xdccResume',
  openExternal = 'irc:openExternal',
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
}
