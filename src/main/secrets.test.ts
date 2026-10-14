import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { type SecretCipher, SecretsStore, withSavedSecrets } from './secrets';

// Reversible but visibly not plaintext, standing in for the OS keystore.
const fakeCipher = (available = true): SecretCipher => ({
  isAvailable: () => available,
  encrypt: (plain) => Buffer.from(`enc:${plain.split('').reverse().join('')}`),
  decrypt: (blob) => {
    const s = blob.toString();
    if (!s.startsWith('enc:')) throw new Error('bad blob');
    return s.slice(4).split('').reverse().join('');
  },
});

let file: string;
beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dolq-secrets-')), 'secrets.json');
});

describe('SecretsStore', () => {
  it('round-trips credentials and never writes them in plaintext', () => {
    const store = new SecretsStore(file, fakeCipher());
    expect(store.remember('s1', { password: 'hunter2', saslUser: 'me', saslPass: 'pw!' })).toBe(true);

    expect(store.get('s1')).toEqual({ password: 'hunter2', saslUser: 'me', saslPass: 'pw!' });
    const raw = fs.readFileSync(file, 'utf-8');
    expect(raw).not.toContain('hunter2');
    expect(raw).not.toContain('pw!');
    expect(new SecretsStore(file, fakeCipher()).get('s1').password).toBe('hunter2');
  });

  it('keeps fields that a later patch leaves out', () => {
    const store = new SecretsStore(file, fakeCipher());
    store.remember('s1', { password: 'one', saslPass: 'two' });
    store.remember('s1', { saslPass: 'three', password: '' });
    expect(store.get('s1')).toEqual({ password: 'one', saslPass: 'three' });
  });

  it('forgets one server without touching another', () => {
    const store = new SecretsStore(file, fakeCipher());
    store.remember('s1', { password: 'a' });
    store.remember('s2', { password: 'b' });
    store.forget('s1');
    expect(store.get('s1')).toEqual({});
    expect(store.get('s2')).toEqual({ password: 'b' });
  });

  it('stores nothing when the OS keystore is unavailable', () => {
    const store = new SecretsStore(file, fakeCipher(false));
    expect(store.available()).toBe(false);
    expect(store.remember('s1', { password: 'a' })).toBe(false);
    expect(store.get('s1')).toEqual({});
    expect(fs.existsSync(file)).toBe(false);
  });

  it('treats an undecryptable value as not saved', () => {
    fs.writeFileSync(file, JSON.stringify({ s1: { password: Buffer.from('garbage').toString('base64') } }));
    expect(new SecretsStore(file, fakeCipher()).get('s1')).toEqual({});
  });

  it('restricts the file to its owner', () => {
    new SecretsStore(file, fakeCipher()).remember('s1', { password: 'a' });
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o077).toBe(0);
  });

  it.skipIf(process.platform === 'win32')('restricts the file even when a leftover temp file was readable', () => {
    fs.writeFileSync(`${file}.tmp`, '{}', { mode: 0o644 });
    fs.chmodSync(`${file}.tmp`, 0o644);
    new SecretsStore(file, fakeCipher()).remember('s1', { password: 'a' });
    expect(fs.statSync(file).mode & 0o077).toBe(0);
  });
});

describe('withSavedSecrets', () => {
  it('only fills in what the caller did not supply', () => {
    expect(
      withSavedSecrets({ password: 'typed', saslUser: '' }, { password: 'old', saslUser: 'u', saslPass: 'p' }),
    ).toEqual({
      password: 'typed',
      saslUser: 'u',
      saslPass: 'p',
    });
  });
});
