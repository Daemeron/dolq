import type { Settings } from '../shared/ipc';

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
