export type Pairing = {
  host: string;
  port: number;
  token: string;
  // Only present for a self-signed certificate; a CA-issued one needs none.
  fingerprint?: string;
  // false for a backend served without TLS (dolqd -tls=false)
  tls: boolean;
};

// Parses the link dolqd prints at startup: dolq://host:port?token=...&fp=...
// Returns null for anything else, including a link with no token.
export function parsePairingLink(text: string): Pairing | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'dolq:') return null;
  const token = url.searchParams.get('token');
  const port = Number(url.port);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!token || !host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return {
    host,
    port,
    token,
    fingerprint: url.searchParams.get('fp') || undefined,
    tls: url.searchParams.get('tls') !== '0',
  };
}

// host:port as shown in the URL field; IPv6 literals need their brackets back.
export function formatHostPort(host: string, port: number): string {
  return `${host.includes(':') ? `[${host}]` : host}:${port}`;
}
