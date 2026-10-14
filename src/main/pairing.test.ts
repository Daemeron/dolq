import { describe, expect, it } from 'vitest';
import { formatHostPort, parsePairingLink } from '../shared/pairing';

const FP = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase()).join(':');

describe('parsePairingLink', () => {
  it('reads host, port, token and fingerprint', () => {
    expect(parsePairingLink(`dolq://192.168.1.5:6789?token=abc123&fp=${encodeURIComponent(FP)}`)).toEqual({
      host: '192.168.1.5',
      port: 6789,
      token: 'abc123',
      fingerprint: FP,
      tls: true,
    });
  });

  it('accepts a lowercase fingerprint and stores it uppercase, like dolqd and Node print it', () => {
    expect(parsePairingLink(`dolq://10.0.0.2:6789?token=t&fp=${FP.toLowerCase()}`)?.fingerprint).toBe(FP);
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
    'dolq://10.0.0.2:6789?token=t&fp=AA:BB',
    `dolq://10.0.0.2:6789?token=t&fp=${FP.replaceAll(':', '')}`,
    `dolq://10.0.0.2:6789?token=t&fp=${FP}:00`,
    `dolq://10.0.0.2:6789?token=t&fp=${FP.slice(0, -2)}ZZ`,
    `dolq://10.0.0.2:6789?token=t&fp=${FP}%0A`,
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
