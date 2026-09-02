import type { Settings } from '../shared/ipc';

// Settings.remoteUrl is a bare "host:port" (dolqd's own -addr shape, see
// docker-compose.yml) - reusing URL's own host/port parsing (handles a
// bracketed IPv6 literal too) rather than a hand-rolled split(':'). Returns
// undefined for remote mode off, or a URL too malformed to have both a
// hostname and a port, so BackendClient falls back to spawning a local
// dolqd either way.
export function resolveRemoteBackend(settings: Settings): { host: string; port: number } | undefined {
  if (!settings.remoteEnabled || !settings.remoteUrl) return undefined;
  try {
    const url = new URL(`tcp://${settings.remoteUrl}`);
    if (!url.hostname || !url.port) return undefined;
    return { host: url.hostname, port: Number(url.port) };
  } catch {
    return undefined;
  }
}
