// Runs air for backend:dev. Windows only runs binaries ending in .exe, so the build is overridden there.
import { spawnSync } from 'node:child_process';

const windows = process.platform === 'win32';
const overrides = windows
  ? ['--build.cmd', 'go build -o ./tmp/dolqd.exe ./cmd/dolqd', '--build.entrypoint', './tmp/dolqd.exe']
  : [];
const { status } = spawnSync('go', ['-C', 'backend', 'run', 'github.com/air-verse/air@v1.67.4', ...overrides], {
  stdio: 'inherit',
});
process.exit(status ?? 1);
