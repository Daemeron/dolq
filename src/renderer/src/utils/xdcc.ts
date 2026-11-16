export function xdccRequestKey(serverId: string, nick: string): string {
  return `${serverId}\0${nick.toLowerCase()}`;
}

export type XdccSender = { nick: string; host?: string; account?: string };

// What makes a sender the same person next time. A services account survives
// a nick change and can't be claimed by taking the nick; without one it takes
// the nick and user@host together. Empty when there is nothing to go on, and
// an empty key is never trusted.
export function xdccSenderKey(s: XdccSender): string {
  if (s.account) return `a:${s.account.toLowerCase()}`;
  if (s.host) return `h:${s.nick.toLowerCase()}!${s.host.toLowerCase()}`;
  return '';
}

// The nick a raw outgoing line asks for a pack, or null for any other line.
export function xdccRequestTarget(line: string): string | null {
  const m = line.match(/^PRIVMSG ([^\s#&]\S*) :xdcc\s+(?:send|get|batch)\b/i);
  return m ? m[1] : null;
}

// How many offers a raw outgoing line should bring: one for send/get, one per pack for "xdcc batch 1-3,7",
// and 0 for any other line.
export function xdccRequestCount(line: string): number {
  const m = line.match(/^PRIVMSG [^\s#&]\S* :xdcc\s+(send|get|batch)\b\s*(.*)$/i);
  if (!m) return 0;
  if (m[1].toLowerCase() !== 'batch') return 1;
  let count = 0;
  for (const part of m[2].split(',')) {
    const range = part.trim().match(/^#?(\d+)(?:\s*-\s*#?(\d+))?$/);
    if (range) count += range[2] ? Math.max(1, Number(range[2]) - Number(range[1]) + 1) : 1;
  }
  return Math.max(1, count);
}

// What was asked of each bot and when. A bot may queue a request and send the file minutes or hours later, so a
// request stays good for a day. After that an offer from the same nick is not taken for the answer to it.
export type Requested = Map<string, { count: number; at: number }>;
export const XDCC_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

/** Records that `count` more offers are expected from `nick`, counted from now. */
export function noteRequest(requested: Requested, serverId: string, nick: string, count: number, now = Date.now()) {
  const key = xdccRequestKey(serverId, nick);
  const previous = requested.get(key);
  const live = previous && now - previous.at < XDCC_REQUEST_TTL_MS ? previous.count : 0;
  requested.set(key, { count: live + count, at: now });
}

// Counts down the offers still expected from a nick (see xdccRequestCount) and says whether this one
// may start without a prompt: a trusted nick always, anyone else only when the global option is on and
// the offer answers a request of ours that is not a day old. A batch brings one offer per pack, so one
// request covers them all.
export function takeAutoAccept(
  enabled: boolean,
  trusted: boolean,
  requested: Requested,
  serverId: string,
  nick: string,
  now = Date.now(),
): boolean {
  const key = xdccRequestKey(serverId, nick);
  const entry = requested.get(key);
  const expected = entry && now - entry.at < XDCC_REQUEST_TTL_MS ? entry.count : 0;
  if (entry && expected > 1) requested.set(key, { count: expected - 1, at: entry.at });
  else requested.delete(key);
  return trusted || (enabled && expected > 0);
}

// In a query window "/xdcc send #5" needs no nick: it is the same as typing "xdcc send #5" there.
export function queryXdccText(text: string): string {
  return /^\/xdcc\s/i.test(text) ? text.slice(1) : text;
}
