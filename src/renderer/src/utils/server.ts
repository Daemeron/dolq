// ServerPreset ids (see data/servers.ts) are "host:port" - deterministic
// and network-scoped, so the same network always dedupes to one preset
// entry no matter how many Server identities (see types.ts) have since
// been connected to it. IPv6 hosts already contain colons of their own,
// but since the port is always a purely numeric trailing segment,
// splitting on the *last* colon unambiguously separates host from port no
// matter how many colons the host itself has.

// Users may paste a bracketed IPv6 literal (e.g. `[::1]`, the URL convention for
// disambiguating an address's own colons from a following `:port`). Our Host and Port
// fields are already separate, so brackets are never actually needed - but Node's
// `net` module doesn't strip them itself and fails to connect if they're left in.
export function normalizeHost(host: string): string {
  const match = host.match(/^\[(.+)\]$/);
  return match ? match[1] : host;
}

export function buildServerId(host: string, port: string | number): string {
  return `${normalizeHost(host)}:${port}`;
}

export function parseServerId(id: string): { host: string; port: number } {
  const lastColon = id.lastIndexOf(':');
  return { host: id.slice(0, lastColon), port: Number(id.slice(lastColon + 1)) };
}

// A Server's own id stopped being host:port once more than one identity
// could point at the same network (see types.ts) - host/port became
// explicit fields instead. This is the fallback for one persisted before
// that existed: its id *is* still "host:port" (the only encoding there
// was), so parseServerId still recovers them correctly.
export function resolveHostPort(server: { id: string; host?: string; port?: number }): { host: string; port: number } {
  if (server.host && server.port) return { host: server.host, port: server.port };
  return parseServerId(server.id);
}
