export type SlashCommand = { kind: 'raw'; line: string } | { kind: 'unknown'; name: string } | { kind: 'not-command' };

const isChannelName = (s: string) => /^[#&!]/.test(s);

// Commands that map straight onto one IRC line. /join, /msg, /me, /away and
// aliases are handled by the caller before this is consulted.
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
    case 'raw':
    case 'quote':
      return rest ? { kind: 'raw', line: rest } : { kind: 'unknown', name };
    default:
      return { kind: 'unknown', name };
  }
}
