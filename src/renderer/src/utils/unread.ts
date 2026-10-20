import type { Channel, Message } from '../types';

export type AwayStats = Record<string, { count: number; people: number }>;

// What arrived "since you last looked" per channel. The channel on screen is
// being looked at, so it never counts.
export function computeAwayStats(
  channels: Channel[],
  selectedChannelId: string,
  lastRead: (channelId: string) => number,
  messagesOf: (channelId: string) => Message[],
): AwayStats {
  const stats: AwayStats = {};
  for (const ch of channels) {
    if (ch.isLog || ch.id === selectedChannelId) continue;
    const since = lastRead(ch.id);
    const nicks = new Set<string>();
    let count = 0;
    for (const msg of messagesOf(ch.id)) {
      if (msg.system || msg.timestamp.getTime() <= since) continue;
      count++;
      if (msg.nick) nicks.add(msg.nick);
    }
    if (count > 0) stats[ch.id] = { count, people: nicks.size };
  }
  return stats;
}
