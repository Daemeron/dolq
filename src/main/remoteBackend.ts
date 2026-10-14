import { isIP } from 'node:net';
import type { Settings } from '../shared/ipc';

export type RemoteTarget = {
  host: string;
  port: number;
  tls: boolean;
  token?: string;
  // SHA-256 of the self-signed certificate the user already accepted, if any.
  fingerprint?: string;
};

// What the user gets asked, and what gets remembered; supplied by the app so
// this stays free of Electron.
export type RemoteHooks = {
  confirmTrust: (fingerprint: string, host: string) => Promise<boolean>;
  confirmInsecure: (host: string) => Promise<boolean>;
  onPin: (fingerprint: string) => void;
};

export function resolveRemoteBackend(settings: Settings, token?: string): RemoteTarget | undefined {
  if (!settings.remoteEnabled || !settings.remoteUrl) return undefined;
  try {
    const url = new URL(`tcp://${settings.remoteUrl}`);
    if (!url.hostname || !url.port) return undefined;
    return {
      // new URL keeps the brackets on an IPv6 literal; sockets want it bare
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: Number(url.port),
      tls: settings.remoteTls ?? true,
      token: token || undefined,
      fingerprint: settings.remoteFingerprint || undefined,
    };
  } catch {
    return undefined;
  }
}

export function isLoopbackHost(host: string): boolean {
  if (host === 'localhost') return true;
  if (isIP(host) === 4) return host.startsWith('127.');
  return host === '::1';
}

export type TrustDecision = 'trusted' | 'prompt' | 'mismatch';

// A certificate that chains to a public CA for this hostname (Let's Encrypt)
// is trusted as is, so it can renew freely. Anything else (self-signed) must
// match the fingerprint the user accepted earlier; the first time there is
// none, so the user is asked.
export function decideTrust(opts: { authorized: boolean; pinned?: string; fingerprint: string }): TrustDecision {
  if (opts.authorized) return 'trusted';
  if (!opts.pinned) return 'prompt';
  return opts.pinned.toUpperCase() === opts.fingerprint.toUpperCase() ? 'trusted' : 'mismatch';
}
