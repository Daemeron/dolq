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

export function resolveHostPort(server: { id: string; host?: string; port?: number }): { host: string; port: number } {
  if (server.host && server.port) return { host: server.host, port: server.port };
  return parseServerId(server.id);
}
