import type { HistoryEntry } from '../../../shared/ipc';

// One human-readable line per entry - covers every event type this app
// actually persists/renders something for elsewhere (App.tsx's onEvent
// switch, MessageArea); anything else (MODE, names snapshots, etc.) falls
// back to raw JSON rather than needing a case search essentially never
// surfaces for a log export anyway.
export function formatEntry(entry: HistoryEntry): string {
  const ts = new Date(entry.timestamp).toISOString();
  if (entry.isRaw) return `[${ts}] ${entry.line ?? ''}`;

  const e = entry.event;
  switch (e?.type) {
    case 'PRIVMSG':
    case 'NOTICE':
      return `[${ts}] <${e.nick}> ${e.text}`;
    case 'ACTION':
      return `[${ts}] * ${e.nick} ${e.text}`;
    case 'JOIN':
      return `[${ts}] ${e.nick} joined ${e.channel}`;
    case 'PART':
      return `[${ts}] ${e.nick} left ${e.channel}${e.reason ? ` (${e.reason})` : ''}`;
    case 'QUIT':
      return `[${ts}] ${e.nick} quit${e.reason ? ` (${e.reason})` : ''}`;
    case 'NICK':
      return `[${ts}] ${e.oldNick} is now known as ${e.newNick}`;
    case 'KICK':
      return `[${ts}] ${e.nick} was kicked by ${e.by}${e.reason ? ` (${e.reason})` : ''}`;
    case 'TOPIC':
      return `[${ts}] ${e.nick ? `${e.nick} set` : 'Topic is'} the topic: ${e.topic}`;
    case 'XDCCPACK':
      return `[${ts}] <${e.nick}> #${e.number} · ${e.gets}x sent · ${e.size} · ${e.filename}`;
    default:
      return `[${ts}] ${e ? JSON.stringify(e) : ''}`;
  }
}
