import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { Settings } from '../shared/ipc';

const DEFAULTS: Settings = { retentionDays: 0 };

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): Settings {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf-8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(settings: Settings): void {
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}
