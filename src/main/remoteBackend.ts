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
  confirmInsecure: (host: string, reasons: string[]) => Promise<boolean>;
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
      // Settings saved before TLS and tokens existed have no remoteTls and no
      // token or pinned certificate: they point at a plain backend, so keep talking plain.
      tls: settings.remoteTls ?? Boolean(token || settings.remoteFingerprint),
      token: token || undefined,
      fingerprint: settings.remoteFingerprint || undefined,
    };
  } catch {
    return undefined;
  }
}

// What is unprotected about this connection, for the warning the user must
// accept first. Empty for a local backend or a fully secured one.
export function insecureReasons(remote: Pick<RemoteTarget, 'host' | 'tls' | 'token'>): string[] {
  if (isLoopbackHost(remote.host)) return [];
  const reasons: string[] = [];
  if (!remote.tls) reasons.push('the connection is not encrypted (TLS is off)');
  if (!remote.token) reasons.push('no access token is used, so anyone who can reach the backend can use it');
  return reasons;
}

export function isLoopbackHost(host: string): boolean {
  if (host === 'localhost') return true;
  if (isIP(host) === 4) return host.startsWith('127.');
  return host === '::1';
}

export type TrustDecision = 'trusted' | 'prompt' | 'mismatch';

// A pinned fingerprint always has to match, even for a CA-valid certificate:
// otherwise anyone who can get a publicly trusted certificate for the host
// could stand in for a self-signed backend the user paired with. Without a
// pin, a certificate that chains to a public CA for this hostname (Let's
// Encrypt) is trusted as is, so it can renew freely; a self-signed one is
// shown to the user to accept.
export function decideTrust(opts: { authorized: boolean; pinned?: string; fingerprint: string }): TrustDecision {
  if (opts.pinned) return opts.pinned.toUpperCase() === opts.fingerprint.toUpperCase() ? 'trusted' : 'mismatch';
  return opts.authorized ? 'trusted' : 'prompt';
}
