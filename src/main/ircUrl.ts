import { IRC_PORT, IRC_TLS_PORT } from '../shared/ipc';

// What a parsed irc:// or ircs:// link prefills the connect form with (see
// registerIrcUrlHandlers in index.ts) - a subset of ConnectForm's own
// fields, deliberately: no password/key modifier is ever pulled out of the
// URL itself. Real-world irc:// links essentially never carry one (there's
// no standard place for it that isn't OS URL-history/registry-visible), so
// this doesn't pretend to parse one.
export type IrcUrlPrefill = {
  host: string;
  port: number;
  secure: boolean;
  channel?: string; // always "#name" shaped
};

// parseIrcUrl reads the loose community convention most IRC clients (mIRC,
// HexChat, KVIrc...) already use for these links:
// irc[s]://<host>[:<port>][/[<channel>][,<modifier>...]]
// - ircs implies TLS and IRC_TLS_PORT's default, irc implies plaintext and
//   IRC_PORT's; either can still carry an explicit :<port>.
// - the channel can arrive two ways: percent-encoded (irc://host/%23name,
//   the "correct" form) lands in the URL's own pathname; a bare unencoded
//   "#name" is extremely common in the wild despite being technically the
//   URL fragment delimiter, not part of the path - browsers/the URL parser
//   put that in .hash instead, so both are checked. A trailing
//   ",needkey"/",needpass"/etc. modifier is dropped, not parsed - it's a
//   flag that a channel needs something, never the value itself.
// Returns null for anything that isn't a well-formed irc(s):// URL at all.
export function parseIrcUrl(raw: string): IrcUrlPrefill | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const secure = url.protocol === 'ircs:';
  if (!secure && url.protocol !== 'irc:') return null;
  if (!url.hostname) return null;

  const port = url.port ? Number(url.port) : secure ? IRC_TLS_PORT : IRC_PORT;

  const pathChannel = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const hashChannel = decodeURIComponent(url.hash.replace(/^#/, ''));
  const name = (pathChannel || hashChannel).split(',')[0];

  return {
    host: url.hostname,
    port,
    secure,
    channel: name ? (name.startsWith('#') ? name : `#${name}`) : undefined,
  };
}
