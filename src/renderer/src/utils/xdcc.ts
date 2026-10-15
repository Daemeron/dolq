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

// Takes the pending request out of `requested` and says whether the offer
// may start without a prompt: a trusted nick always, anyone else only when
// the global option is on and the offer answers a request of ours.
export function takeAutoAccept(
  enabled: boolean,
  trusted: boolean,
  requested: Set<string>,
  serverId: string,
  nick: string,
): boolean {
  const wasRequested = requested.delete(xdccRequestKey(serverId, nick));
  return trusted || (enabled && wasRequested);
}
