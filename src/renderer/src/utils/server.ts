import { nickColor } from './nickColor';

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

// The two letters on a server's icon: the first letters of its first two words ("Libera.Chat" is LC), or the
// first two characters of a single word ("Rizon" is Ri).
export function serverInitials(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return letters.charAt(0).toUpperCase() + letters.slice(1);
}

/** The colour of a server's icon: the user's choice, else a stable pick from the nick palette. */
export function serverColor(server: { id: string; color?: string }): string {
  return server.color || nickColor(server.id);
}

export function serverIconText(server: { name: string; initials?: string }): string {
  return server.initials || serverInitials(server.name);
}
