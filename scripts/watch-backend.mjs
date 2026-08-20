#!/usr/bin/env node
// Rebuilds and restarts dolqd on any backend/**/*.go change - `npm run
// dev:backend:watch`. Builds a real binary and spawns that directly rather
// than `go run` - see BackendClient.ts's resolveBackendCommand for why:
// `go run` wraps the binary in a child of its own that doesn't reliably
// forward SIGTERM/SIGINT, so killing it to restart leaks the actual dolqd
// process instead of stopping it.
//
// No new dependency for the watching itself: fs.watch's recursive option
// already covers this on macOS (this project's primary dev platform, see
// README's Prerequisites) and Windows; Linux's inotify-backed recursive
// support is less consistent, so a change there might not always trigger a
// restart - rerun the script by hand if so.
import { spawn, execFile } from 'node:child_process';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const backendDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'backend');
const binaryPath = path.join(os.tmpdir(), `dolqd-watch-${process.pid}`);

let child = null;
let restarting = false;
let pending = false;

async function buildAndStart() {
  try {
    await execFileAsync('go', ['build', '-o', binaryPath, './cmd/dolqd'], { cwd: backendDir });
  } catch (err) {
    console.error('[watch-backend] build failed:\n' + err.stderr);
    return;
  }
  child = spawn(binaryPath, process.argv.slice(2), { stdio: 'inherit' });
}

// Debounced (a save can touch a few files - formatter, etc. - in one go)
// and serialized (a restart already in flight finishes before another
// starts, rather than two builds racing each other for binaryPath).
function restart() {
  if (restarting) {
    pending = true;
    return;
  }
  restarting = true;
  console.log('[watch-backend] change detected, restarting dolqd...');
  const rebuild = () => buildAndStart().finally(() => {
    restarting = false;
    if (pending) {
      pending = false;
      restart();
    }
  });
  if (child) {
    child.once('exit', rebuild);
    child.kill();
  } else {
    rebuild();
  }
}

let debounceTimer = null;
watch(backendDir, { recursive: true }, (_event, filename) => {
  if (!filename || !filename.endsWith('.go')) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(restart, 200);
});

function shutdown() {
  clearTimeout(debounceTimer);
  if (child) child.kill();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

buildAndStart();
