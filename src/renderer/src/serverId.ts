// A server is identified by "host:port". IPv6 hosts already contain colons of their
// own, but since the port is always a purely numeric trailing segment, splitting on
// the *last* colon unambiguously separates host from port no matter how many colons
// the host itself has.

// Users may paste a bracketed IPv6 literal (e.g. `[::1]`, the URL convention for
// disambiguating an address's own colons from a following `:port`). Our Host and Port
// fields are already separate, so brackets are never actually needed - but Node's
// `net` module doesn't strip them itself and fails to connect if they're left in.
function stripBrackets(host: string): string {
  const match = host.match(/^\[(.+)\]$/);
  return match ? match[1] : host;
}

export function buildServerId(host: string, port: string | number): string {
  return `${stripBrackets(host)}:${port}`;
}

export function parseServerId(id: string): { host: string; port: number } {
  const lastColon = id.lastIndexOf(':');
  return { host: id.slice(0, lastColon), port: Number(id.slice(lastColon + 1)) };
}
