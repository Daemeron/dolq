import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import type { Settings } from '../shared/ipc';

const DEFAULTS: Settings = { retentionDays: 0 };

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

// Synchronous, not async: read once at startup - before BackendClient spawns
// dolqd, which needs retentionDays as a launch flag, so there's no window to
// await anything in anyway - and written rarely (only from the Preferences
// panel). Not worth an async load/save path for a file this small and cold.
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
