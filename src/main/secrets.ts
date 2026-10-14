import fs from 'node:fs';
import path from 'node:path';

export type ServerSecrets = { password?: string; saslUser?: string; saslPass?: string; remoteToken?: string };

// The OS-backed cipher (Electron's safeStorage in the app, a fake in tests).
export type SecretCipher = {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(blob: Buffer): string;
};

const FIELDS: (keyof ServerSecrets)[] = ['password', 'saslUser', 'saslPass', 'remoteToken'];

type FileShape = Record<string, Partial<Record<keyof ServerSecrets, string>>>;

// Per-server credentials, each value encrypted with the OS keystore and kept
// in a file only the current user can read. Plaintext never leaves the main
// process except on its way to the backend for a connect.
export class SecretsStore {
  constructor(
    private readonly file: string,
    private readonly cipher: SecretCipher,
  ) {}

  available(): boolean {
    return this.cipher.isAvailable();
  }

  get(serverId: string): ServerSecrets {
    if (!this.available()) return {};
    const entry = this.read()[serverId];
    const out: ServerSecrets = {};
    for (const field of FIELDS) {
      const blob = entry?.[field];
      if (!blob) continue;
      try {
        out[field] = this.cipher.decrypt(Buffer.from(blob, 'base64'));
      } catch {
        // Undecryptable (keystore reset, file from another machine): behave as if never saved.
      }
    }
    return out;
  }

  // Only the fields present (non-empty) in patch are written; others are kept.
  remember(serverId: string, patch: ServerSecrets): boolean {
    if (!this.available()) return false;
    const data = this.read();
    const entry = { ...data[serverId] };
    for (const field of FIELDS) {
      const value = patch[field];
      if (value) entry[field] = this.cipher.encrypt(value).toString('base64');
    }
    data[serverId] = entry;
    this.write(data);
    return true;
  }

  forget(serverId: string): void {
    const data = this.read();
    if (!(serverId in data)) return;
    delete data[serverId];
    this.write(data);
  }

  private read(): FileShape {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf-8')) as FileShape;
    } catch {
      return {};
    }
  }

  private write(data: FileShape): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    // mode only applies when the file is created; a .tmp left behind by a crash keeps its own
    try {
      fs.chmodSync(tmp, 0o600);
    } catch {
      // best effort (e.g. Windows)
    }
    fs.renameSync(tmp, this.file);
  }
}

// A saved value only fills in for one the caller did not supply.
export function withSavedSecrets(given: ServerSecrets, saved: ServerSecrets): ServerSecrets {
  return {
    password: given.password || saved.password,
    saslUser: given.saslUser || saved.saslUser,
    saslPass: given.saslPass || saved.saslPass,
  };
}
