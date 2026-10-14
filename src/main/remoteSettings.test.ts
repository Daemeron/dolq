import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../shared/ipc';
import { applyIncomingSettings, BACKEND_SECRET_ID } from './remoteSettings';

const base: Settings = {
  retentionDays: 0,
  remoteUrl: 'tcp://a.example:6789',
  remoteFingerprint: 'AA:BB',
  remoteToken: 'plain-token',
};

// remember() returns whether a keychain took the token.
const fakeSecrets = (keychain = true) => ({
  remember: vi.fn(() => keychain),
  forget: vi.fn(),
});

describe('applyIncomingSettings', () => {
  it('keeps the saved token and pin when the address is unchanged', () => {
    const secrets = fakeSecrets();
    const next = applyIncomingSettings(base, { ...base, remoteToken: undefined }, secrets);
    expect(next.remoteToken).toBe('plain-token');
    expect(next.remoteFingerprint).toBe('AA:BB');
    expect(secrets.forget).not.toHaveBeenCalled();
    expect(secrets.remember).not.toHaveBeenCalled();
  });

  it('forgets the token and drops the pin when the address changes without a new token', () => {
    const secrets = fakeSecrets();
    const next = applyIncomingSettings(
      base,
      { ...base, remoteUrl: 'tcp://b.example:6789', remoteToken: undefined },
      secrets,
    );
    expect(secrets.forget).toHaveBeenCalledWith(BACKEND_SECRET_ID);
    expect(next.remoteToken).toBeUndefined();
    expect(next.remoteFingerprint).toBeUndefined();
  });

  it('keeps a pin that arrives together with the new address', () => {
    const next = applyIncomingSettings(
      base,
      { ...base, remoteUrl: 'tcp://b.example:6789', remoteFingerprint: 'CC:DD', remoteToken: undefined },
      fakeSecrets(),
    );
    expect(next.remoteFingerprint).toBe('CC:DD');
  });

  it('stores a new token in the keychain and keeps it out of settings', () => {
    const secrets = fakeSecrets(true);
    const next = applyIncomingSettings(
      base,
      { ...base, remoteUrl: 'tcp://b.example:6789', remoteToken: 'new' },
      secrets,
    );
    expect(secrets.remember).toHaveBeenCalledWith(BACKEND_SECRET_ID, { remoteToken: 'new' });
    expect(secrets.forget).not.toHaveBeenCalled();
    expect(next.remoteToken).toBeUndefined();
  });

  it('falls back to settings when there is no keychain', () => {
    const next = applyIncomingSettings(base, { ...base, remoteToken: 'new' }, fakeSecrets(false));
    expect(next.remoteToken).toBe('new');
  });

  it('never persists the renderer-only remoteTokenSet flag', () => {
    const next = applyIncomingSettings(base, { ...base, remoteTokenSet: true }, fakeSecrets());
    expect(next).not.toHaveProperty('remoteTokenSet');
  });
});
