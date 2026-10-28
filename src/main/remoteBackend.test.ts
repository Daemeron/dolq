import { describe, expect, it } from 'vitest';
import { decideTrust, insecureReasons, isLoopbackHost, resolveRemoteBackend } from './remoteBackend';

describe('resolveRemoteBackend', () => {
  it('parses a host:port URL when remote mode is on', () => {
    expect(resolveRemoteBackend({ retentionDays: 0, remoteEnabled: true, remoteUrl: 'dolq.example.com:6789' })).toEqual(
      { host: 'dolq.example.com', port: 6789, tls: false, token: undefined, fingerprint: undefined },
    );
  });

  it('keeps settings from before TLS existed talking plain, and enables TLS once a token or pin is set', () => {
    const legacy = { retentionDays: 0, remoteEnabled: true, remoteUrl: 'nas.local:6789' };
    expect(resolveRemoteBackend(legacy)?.tls).toBe(false);
    expect(resolveRemoteBackend(legacy, 'tok')?.tls).toBe(true);
    expect(resolveRemoteBackend({ ...legacy, remoteFingerprint: 'AA' })?.tls).toBe(true);
    expect(resolveRemoteBackend({ ...legacy, remoteTls: true })?.tls).toBe(true);
  });

  it('carries the token, the TLS choice and the pinned fingerprint', () => {
    expect(
      resolveRemoteBackend(
        {
          retentionDays: 0,
          remoteEnabled: true,
          remoteUrl: '10.0.0.2:6789',
          remoteTls: false,
          remoteFingerprint: 'AA',
        },
        'tok',
      ),
    ).toEqual({ host: '10.0.0.2', port: 6789, tls: false, token: 'tok', fingerprint: 'AA' });
  });

  it('strips the brackets from an IPv6 literal', () => {
    expect(resolveRemoteBackend({ retentionDays: 0, remoteEnabled: true, remoteUrl: '[::1]:6789' })?.host).toBe('::1');
  });

  it('is undefined when remote mode is off, even with a url set', () => {
    expect(
      resolveRemoteBackend({ retentionDays: 0, remoteEnabled: false, remoteUrl: 'dolq.example.com:6789' }),
    ).toBeUndefined();
  });

  it('is undefined when remote mode is on but no url is set', () => {
    expect(resolveRemoteBackend({ retentionDays: 0, remoteEnabled: true })).toBeUndefined();
  });

  it('is undefined for a url missing a port', () => {
    expect(
      resolveRemoteBackend({ retentionDays: 0, remoteEnabled: true, remoteUrl: 'dolq.example.com' }),
    ).toBeUndefined();
  });
});

describe('decideTrust', () => {
  it('trusts a CA-issued certificate when nothing is pinned, whatever its fingerprint (ACME renewals)', () => {
    expect(decideTrust({ authorized: true, fingerprint: 'AA' })).toBe('trusted');
    expect(decideTrust({ authorized: true, fingerprint: 'BB' })).toBe('trusted');
  });

  it('holds a CA-issued certificate to the pin when one exists', () => {
    expect(decideTrust({ authorized: true, pinned: 'BB', fingerprint: 'AA' })).toBe('mismatch');
    expect(decideTrust({ authorized: true, pinned: 'aa', fingerprint: 'AA' })).toBe('trusted');
  });

  it('asks the first time it sees a self-signed certificate', () => {
    expect(decideTrust({ authorized: false, fingerprint: 'AA' })).toBe('prompt');
  });

  it('accepts a self-signed certificate that matches the pin, ignoring case', () => {
    expect(decideTrust({ authorized: false, pinned: 'aa:bb', fingerprint: 'AA:BB' })).toBe('trusted');
  });

  it('refuses a self-signed certificate that differs from the pin', () => {
    expect(decideTrust({ authorized: false, pinned: 'AA', fingerprint: 'BB' })).toBe('mismatch');
  });
});

describe('insecureReasons', () => {
  it('has nothing to say about a fully secured backend or a local one', () => {
    expect(insecureReasons({ host: 'nas.local', tls: true, token: 't' })).toEqual([]);
    expect(insecureReasons({ host: '127.0.0.1', tls: false, token: undefined })).toEqual([]);
  });

  it('names each missing protection on a non-local host', () => {
    expect(insecureReasons({ host: 'nas.local', tls: false, token: 't' })).toHaveLength(1);
    expect(insecureReasons({ host: 'nas.local', tls: true, token: undefined })).toHaveLength(1);
    expect(insecureReasons({ host: '10.0.0.2', tls: false, token: undefined })).toHaveLength(2);
  });
});

describe('isLoopbackHost', () => {
  it('recognizes only local addresses', () => {
    expect(['localhost', '127.0.0.1', '127.1.2.3', '::1'].every(isLoopbackHost)).toBe(true);
    expect(['10.0.0.1', 'example.com', '::2', '0.0.0.0'].some(isLoopbackHost)).toBe(false);
  });
});

describe('resolveRemoteBackend: unusable addresses', () => {
  it('refuses a URL that does not parse, or that has no port', () => {
    expect(resolveRemoteBackend({ retentionDays: 0, remoteEnabled: true, remoteUrl: '[broken' })).toBeUndefined();
    expect(
      resolveRemoteBackend({ retentionDays: 0, remoteEnabled: true, remoteUrl: 'host-without-port' }),
    ).toBeUndefined();
  });
});
