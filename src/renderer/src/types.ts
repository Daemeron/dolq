import type { PrivilegeLevel } from '../../shared/ipc';

export type Server = {
  // Opaque and freshly generated per connection (crypto.randomUUID()) -
  // deliberately *not* derived from host:port, unlike before "Multiple
  // identities per network" existed: two Servers can now point at the same
  // host:port (different nick/SASL/etc. each, e.g. work vs. personal), and
  // reusing a deterministic id would collide the moment a second one was
  // added. host/port are explicit fields for exactly that reason - nothing
  // can be parsed back out of the id anymore. See utils/server.ts for the
  // fallback that still parses id the old way, for a Server persisted
  // before this existed and so missing these.
  id: string;
  name: string;
  initial: string;
  secure: boolean;
  host?: string;
  port?: number;
  // Per-server identity defaults, all optional - empty/missing behaves
  // exactly as before these existed (ircclient defaults username/realname
  // from nick, altNicks unused, autojoinChannels nothing to join).
  altNicks?: string[];
  username?: string;
  realname?: string;
  autojoinChannels?: string[];
};

export type Channel = {
  id: string;
  name: string;
  isLog: boolean;
  // A DM/query - id is the correspondent's bare nick, same convention as a
  // channel's id being its bare "#name" (see App.tsx's PRIVMSG handling).
  isQuery?: boolean;
  // A DCC CHAT session - id is its "dcc:<uuid>" session id (see
  // window.irc.dccOffer/dccAccept), name is still the peer's nick. Always
  // paired with isQuery: true, it renders the same way (query-style
  // TopicBar/MessageInput), just in its own sidebar section and closed via
  // dccClose instead of PART - see ChannelList/App.tsx's handleRemoveChannel.
  isDCC?: boolean;
  topic?: string;
  topicSetBy?: string;
  topicSetAt?: Date;
};

export type Message = {
  id: number;
  nick: string;
  text: string;
  timestamp: Date;
  isRaw?: boolean;
  system?: boolean;
  action?: boolean;
  notice?: boolean;
  // A parsed XDCC pack-listing row (see IrcEvent's XDCCPACK) - rendered as
  // a distinct line, not the bot's raw NOTICE text. nick is the bot;
  // xdccPackNumber is what a click sends back as "XDCC SEND #n".
  xdccPack?: boolean;
  xdccPackNumber?: number;
};

export type User = {
  nick: string;
  privileges: PrivilegeLevel[];
  // Only ever set true by an away-notify update or a WHOIS reply after this
  // app has actually seen one - a user who was already away before either
  // happens shows as present until then, an IRCv3 away-notify limitation
  // (it only reports *changes*, not current state at NAMES time) this
  // doesn't try to work around.
  away?: boolean;
};
