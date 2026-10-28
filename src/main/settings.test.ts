import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dir = vi.hoisted(() => ({ path: '' }));
vi.mock('electron', () => ({ app: { getPath: () => dir.path } }));

import { loadSettings, saveSettings } from './settings';

describe('settings file', () => {
  beforeEach(() => {
    dir.path = fs.mkdtempSync(path.join(os.tmpdir(), 'dolq-settings-'));
  });
  afterEach(() => fs.rmSync(dir.path, { recursive: true, force: true }));

  it('falls back to defaults when there is no file yet', () => {
    expect(loadSettings()).toEqual({ retentionDays: 0 });
  });

  it('falls back to defaults when the file is corrupt', () => {
    fs.writeFileSync(path.join(dir.path, 'settings.json'), '{not json');
    expect(loadSettings()).toEqual({ retentionDays: 0 });
  });

  it('round-trips saved settings and fills in defaults for missing keys', () => {
    saveSettings({ retentionDays: 30, trayEnabled: true });
    expect(loadSettings()).toEqual({ retentionDays: 30, trayEnabled: true });
    fs.writeFileSync(path.join(dir.path, 'settings.json'), JSON.stringify({ trayEnabled: true }));
    expect(loadSettings()).toEqual({ retentionDays: 0, trayEnabled: true });
  });

  it.skipIf(process.platform === 'win32')('keeps the file owner-only because it can hold the remote token', () => {
    saveSettings({ retentionDays: 0, remoteToken: 'secret' });
    const mode = fs.statSync(path.join(dir.path, 'settings.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
