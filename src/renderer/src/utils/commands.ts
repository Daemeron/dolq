export type SlashCommand =
  | { kind: 'raw'; line: string }
  | { kind: 'lines'; lines: string[] }
  | { kind: 'unknown'; name: string }
  | { kind: 'not-command' };

const isChannelName = (s: string) => /^[#&!]/.test(s);

// Commands that map straight onto one IRC line. /join, /msg, /query, /me, /away,
// /ignore and aliases are handled by the caller before this is consulted.
export function parseSlashCommand(text: string, target: string): SlashCommand {
  // "//foo" is the escape for a message that really starts with a slash.
  if (!text.startsWith('/') || text.startsWith('//')) return { kind: 'not-command' };
  const m = text.match(/^\/(\S+)(?:\s+(.*))?$/);
  if (!m) return { kind: 'not-command' };
  const name = m[1].toLowerCase();
  const rest = (m[2] ?? '').trim();
  const [first = '', ...others] = rest.split(/\s+/).filter(Boolean);
  const after = others.join(' ');

  switch (name) {
    case 'nick':
      return first ? { kind: 'raw', line: `NICK ${first}` } : { kind: 'unknown', name };
    case 'part':
    case 'leave': {
      const channel = isChannelName(first) ? first : target;
      const reason = isChannelName(first) ? after : rest;
      return { kind: 'raw', line: reason ? `PART ${channel} :${reason}` : `PART ${channel}` };
    }
    case 'topic':
      return { kind: 'raw', line: rest ? `TOPIC ${target} :${rest}` : `TOPIC ${target}` };
    case 'mode':
      if (!rest) return { kind: 'raw', line: `MODE ${target}` };
      return { kind: 'raw', line: isChannelName(first) ? `MODE ${rest}` : `MODE ${target} ${rest}` };
    case 'kick':
      return first
        ? { kind: 'raw', line: `KICK ${target} ${first}${after ? ` :${after}` : ''}` }
        : { kind: 'unknown', name };
    case 'invite':
      return first
        ? { kind: 'raw', line: `INVITE ${first} ${isChannelName(others[0] ?? '') ? others[0] : target}` }
        : { kind: 'unknown', name };
    case 'notice':
      return first && after ? { kind: 'raw', line: `NOTICE ${first} :${after}` } : { kind: 'unknown', name };
    case 'cycle':
    case 'rejoin':
      return isChannelName(target)
        ? { kind: 'lines', lines: [`PART ${target}`, `JOIN ${target}`] }
        : { kind: 'unknown', name };
    case 'kickban':
    case 'kb':
      return first && isChannelName(target)
        ? {
            kind: 'lines',
            lines: [`MODE ${target} +b ${first}!*@*`, `KICK ${target} ${first}${after ? ` :${after}` : ''}`],
          }
        : { kind: 'unknown', name };
    case 'list':
      return { kind: 'raw', line: rest ? `LIST ${rest}` : 'LIST' };
    case 'names': {
      const channel = first || (isChannelName(target) ? target : '');
      return { kind: 'raw', line: channel ? `NAMES ${channel}` : 'NAMES' };
    }
    case 'who':
      return first ? { kind: 'raw', line: `WHO ${first}` } : { kind: 'unknown', name };
    case 'whowas':
      return first ? { kind: 'raw', line: `WHOWAS ${first}` } : { kind: 'unknown', name };
    case 'userhost':
    case 'ison':
      return rest ? { kind: 'raw', line: `${name.toUpperCase()} ${rest}` } : { kind: 'unknown', name };
    case 'motd':
    case 'info':
    case 'lusers':
    case 'admin':
    case 'time':
      return { kind: 'raw', line: name.toUpperCase() };
    case 'version':
      return { kind: 'raw', line: first ? `PRIVMSG ${first} :\x01VERSION\x01` : 'VERSION' };
    case 'ping':
      return first ? { kind: 'raw', line: `PRIVMSG ${first} :\x01PING ${Date.now()}\x01` } : { kind: 'unknown', name };
    case 'ctcp':
      return first && after
        ? { kind: 'raw', line: `PRIVMSG ${first} :\x01${after.toUpperCase()}\x01` }
        : { kind: 'unknown', name };
    case 'knock':
      return first ? { kind: 'raw', line: `KNOCK ${rest}` } : { kind: 'unknown', name };
    case 'op':
    case 'deop':
    case 'voice':
    case 'devoice': {
      if (!first) return { kind: 'unknown', name };
      const flag = (name.endsWith('op') ? 'o' : 'v').repeat(others.length + 1);
      return { kind: 'raw', line: `MODE ${target} ${name.startsWith('de') ? '-' : '+'}${flag} ${rest}` };
    }
    case 'ban':
    case 'unban':
      return first
        ? { kind: 'raw', line: `MODE ${target} ${name === 'ban' ? '+b' : '-b'} ${first}` }
        : { kind: 'unknown', name };
    case 'nickserv':
    case 'ns':
    case 'chanserv':
    case 'cs':
      return rest
        ? { kind: 'raw', line: `PRIVMSG ${name.startsWith('n') ? 'NickServ' : 'ChanServ'} :${rest}` }
        : { kind: 'unknown', name };
    case 'raw':
    case 'quote':
      return rest ? { kind: 'raw', line: rest } : { kind: 'unknown', name };
    default:
      return { kind: 'unknown', name };
  }
}
