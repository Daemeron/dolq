import { describe, expect, it } from 'vitest';
import { formatHostPort, parsePairingLink } from '../shared/pairing';

describe('parsePairingLink', () => {
  it('reads host, port, token and fingerprint', () => {
    expect(parsePairingLink('dolq://192.168.1.5:6789?token=abc123&fp=AA%3ABB')).toEqual({
      host: '192.168.1.5',
      port: 6789,
      token: 'abc123',
      fingerprint: 'AA:BB',
      tls: true,
    });
  });

  it('allows a link without a fingerprint (CA-issued certificate) and surrounding whitespace', () => {
    expect(parsePairingLink('  dolq://dolq.example.com:443?token=t \n')).toEqual({
      host: 'dolq.example.com',
      port: 443,
      token: 't',
      fingerprint: undefined,
      tls: true,
    });
  });

  it('reads tls=0 as a backend served without TLS', () => {
    expect(parsePairingLink('dolq://10.0.0.2:6789?token=t&tls=0')?.tls).toBe(false);
  });

  it('handles an IPv6 host', () => {
    expect(parsePairingLink('dolq://[fe80::1]:6789?token=t')?.host).toBe('fe80::1');
  });

  it.each([
    'https://192.168.1.5:6789?token=t',
    'dolq://192.168.1.5:6789',
    'dolq://192.168.1.5?token=t',
    'dolq://:6789?token=t',
    'not a link',
    '',
  ])('rejects %j', (text) => {
    expect(parsePairingLink(text)).toBeNull();
  });
});

describe('formatHostPort', () => {
  it('brackets IPv6 literals only', () => {
    expect(formatHostPort('10.0.0.2', 6789)).toBe('10.0.0.2:6789');
    expect(formatHostPort('::1', 6789)).toBe('[::1]:6789');
  });
});
