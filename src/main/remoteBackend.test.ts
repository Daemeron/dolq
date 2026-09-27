import { describe, expect, it } from 'vitest';
import { resolveRemoteBackend } from './remoteBackend';

describe('resolveRemoteBackend', () => {
  it('parses a host:port URL when remote mode is on', () => {
    expect(resolveRemoteBackend({ retentionDays: 0, remoteEnabled: true, remoteUrl: 'dolq.example.com:6789' })).toEqual(
      {
        host: 'dolq.example.com',
        port: 6789,
      },
    );
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
