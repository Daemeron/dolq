/** Where the user is in the main area: the Dashboard, or one conversation. */
export type NavLocation = { kind: 'dashboard' } | { kind: 'chat'; serverId: string; channelId: string };

export type NavHistory = { entries: NavLocation[]; index: number };

const MAX_ENTRIES = 50;

export const locationKey = (l: NavLocation): string =>
  l.kind === 'dashboard' ? 'dashboard' : `chat:${l.serverId}:${l.channelId}`;

export const startHistory = (at: NavLocation): NavHistory => ({ entries: [at], index: 0 });

/** Arriving somewhere new drops whatever was ahead, as a browser does. Arriving where we already are changes nothing. */
export function visit(h: NavHistory, to: NavLocation): NavHistory {
  if (locationKey(h.entries[h.index]) === locationKey(to)) return h;
  const entries = [...h.entries.slice(0, h.index + 1), to].slice(-MAX_ENTRIES);
  return { entries, index: entries.length - 1 };
}

/** The nearest entry in `direction` (-1 back, +1 forward) that is still reachable, or null. */
export function step(h: NavHistory, direction: -1 | 1, reachable: (l: NavLocation) => boolean): number | null {
  for (let i = h.index + direction; i >= 0 && i < h.entries.length; i += direction) {
    if (reachable(h.entries[i])) return i;
  }
  return null;
}
