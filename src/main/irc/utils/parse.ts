import type { IrcEvent as PublicIrcEvent, PrivilegeLevel } from '../../../shared/ipc';

export type User = { nick: string; privilege: PrivilegeLevel };

// Raw, one-wire-line-per-event shapes (RFC command/reply names, uppercase).
// NAMREPLY/ENDOFNAMES never leave the main process: IrcClient buffers them
// into the synthesized lowercase `names` event from PublicIrcEvent.
export type IrcEvent = Exclude<PublicIrcEvent, { type: 'names' }>
  | { type: 'NAMREPLY'; channel: string; users: User[] }
  | { type: 'ENDOFNAMES'; channel: string };

// NAMES only ever reports a single (the highest) prefix per user without the
// multi-prefix capability, which this client doesn't negotiate.
const PREFIX_TO_PRIVILEGE: Record<string, PrivilegeLevel> = {
  '~': 'owner', '&': 'admin', '@': 'op', '%': 'halfop', '+': 'voice',
};

// MODE letter -> privilege, for the letters that change a user's channel privilege.
const MODE_LETTER_TO_PRIVILEGE: Record<string, Exclude<PrivilegeLevel, 'none'>> = {
  q: 'owner', a: 'admin', o: 'op', h: 'halfop', v: 'voice',
};

// Non-privilege CHANMODES letters, classified by how they consume `args` - needed so a
// privilege change bundled in the same MODE line as one of these (e.g. `+ob nick mask`)
// doesn't get its argument misaligned. Based on Ergo's advertised
// `CHANMODES=Ibe,k,fl,CEMRUimnstu` (list-type, always-arg, set-only-arg, never-arg).
const ALWAYS_ARG_LETTERS = new Set(['b', 'e', 'I', 'k']); // list-type (b/e/I) + key (k)
const SET_ONLY_ARG_LETTERS = new Set(['f', 'l']); // forward target / user limit
const NEVER_ARG_LETTERS = new Set(['C', 'E', 'M', 'R', 'U', 'i', 'm', 'n', 's', 't', 'u']);

function parseNames(nickList: string): User[] {
  return nickList.split(/\s+/).filter(Boolean).map((raw) => {
    const prefix = raw[0];
    const privilege = PREFIX_TO_PRIVILEGE[prefix] ?? 'none';
    const nick = privilege === 'none' ? raw : raw.slice(1);
    return { nick, privilege };
  });
}

// Extracts privilege changes (qaohv) from a MODE line, correctly skipping over any
// other recognized CHANMODES letters bundled into the same line (e.g. `+ob nick mask`)
// so their arguments don't misalign the ones that follow. A letter this client doesn't
// recognize at all means it can no longer be sure how many args the rest of the line
// consumes, so parsing stops there - whatever privilege changes were already found
// (earlier in the same line) are still returned rather than discarded.
function parseChannelModeChanges(
  modeString: string,
  args: string[],
): { nick: string; privilege: Exclude<PrivilegeLevel, 'none'>; granted: boolean }[] | null {
  const changes: { nick: string; privilege: Exclude<PrivilegeLevel, 'none'>; granted: boolean }[] = [];
  let granted = true;
  let argIndex = 0;

  for (const letter of modeString) {
    if (letter === '+') { granted = true; continue; }
    if (letter === '-') { granted = false; continue; }

    const privilege = MODE_LETTER_TO_PRIVILEGE[letter];
    if (privilege) {
      const nick = args[argIndex++];
      if (!nick) break;
      changes.push({ nick, privilege, granted });
      continue;
    }
    if (ALWAYS_ARG_LETTERS.has(letter)) { argIndex++; continue; }
    if (SET_ONLY_ARG_LETTERS.has(letter)) { if (granted) argIndex++; continue; }
    if (NEVER_ARG_LETTERS.has(letter)) continue;
    break; // unrecognized letter - arg alignment past this point is no longer reliable
  }

  return changes.length ? changes : null;
}

// One entry per wire message we understand: `pattern` matches the raw line,
// `build` turns the capture groups into the event. Add new RFC commands/replies
// by appending an entry here — `parseIrcLine` itself never needs to change.
const RULES: { pattern: RegExp; build: (m: RegExpMatchArray) => IrcEvent | null }[] = [
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
    pattern: /^:([^!\s]+)!\S+ KICK (#\S+) (\S+)(?: :(.*))?$/,
    build: (m) => ({ type: 'KICK', by: m[1], channel: m[2], nick: m[3], reason: m[4] }),
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
    pattern: /^:[^!\s]+!\S+ MODE (#\S+) ([-+]\S+)(.*)$/,
    build: (m) => {
      const args = m[3].trim().split(/\s+/).filter(Boolean);
      const changes = parseChannelModeChanges(m[2], args);
      return changes ? { type: 'MODE', channel: m[1], changes } : null;
    },
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
