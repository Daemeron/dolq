import type { IrcEvent as PublicIrcEvent } from '../../shared/ipc';

export type User = { nick: string; isOp: boolean };

// Raw, one-wire-line-per-event shapes (RFC command/reply names, uppercase).
// NAMREPLY/ENDOFNAMES never leave the main process: IrcClient buffers them
// into the synthesized lowercase `names` event from PublicIrcEvent.
export type IrcEvent = Exclude<PublicIrcEvent, { type: 'names' }>
  | { type: 'NAMREPLY'; channel: string; users: User[] }
  | { type: 'ENDOFNAMES'; channel: string };

function parseNames(nickList: string): User[] {
  return nickList.split(/\s+/).filter(Boolean).map((raw) => {
    const isOp = raw.startsWith('@');
    const nick = /^[@+%~&]/.test(raw) ? raw.slice(1) : raw;
    return { nick, isOp };
  });
}

// One entry per wire message we understand: `pattern` matches the raw line,
// `build` turns the capture groups into the event. Add new RFC commands/replies
// by appending an entry here — `parseIrcLine` itself never needs to change.
const RULES: { pattern: RegExp; build: (m: RegExpMatchArray) => IrcEvent }[] = [
  {
    pattern: /^:([^!\s]+)!\S+ PRIVMSG (#\S+) :(.*)$/,
    build: (m) => ({ type: 'PRIVMSG', nick: m[1], target: m[2], text: m[3] }),
  },
  {
    pattern: /^:([^!\s]+)!\S+ JOIN :?(#\S+)/,
    build: (m) => ({ type: 'JOIN', nick: m[1], channel: m[2] }),
  },
  {
    pattern: /^:([^!\s]+)!\S+ PART (#\S+)(?: :(.*))?$/,
    build: (m) => ({ type: 'PART', nick: m[1], channel: m[2], reason: m[3] }),
  },
  {
    pattern: /^:([^!\s]+)!\S+ QUIT(?: :(.*))?$/,
    build: (m) => ({ type: 'QUIT', nick: m[1], reason: m[2] }),
  },
  {
    pattern: /^:([^!\s]+)!\S+ NICK :?(\S+)$/,
    build: (m) => ({ type: 'NICK', oldNick: m[1], newNick: m[2] }),
  },
  {
    pattern: /^:\S+ 353 \S+ [=*@] (#\S+) :(.*)$/,
    build: (m) => ({ type: 'NAMREPLY', channel: m[1], users: parseNames(m[2]) }),
  },
  {
    pattern: /^:\S+ 366 \S+ (#\S+)/,
    build: (m) => ({ type: 'ENDOFNAMES', channel: m[1] }),
  },
];

export function parseIrcLine(line: string): IrcEvent | null {
  for (const rule of RULES) {
    const m = line.match(rule.pattern);
    if (m) return rule.build(m);
  }
  return null;
}
