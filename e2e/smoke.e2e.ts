import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { IrcApi } from '../src/shared/ipc';

const root = path.resolve(__dirname, '..');

// Keep go's caches where they are, since HOME is pointed elsewhere below.
function goEnv(): Record<string, string> {
  const names = ['GOCACHE', 'GOMODCACHE', 'GOPATH', 'GOENV'];
  const values = execFileSync('go', ['env', ...names], { encoding: 'utf-8' })
    .trim()
    .split('\n');
  return Object.fromEntries(names.map((n, i) => [n, values[i]]));
}

// dolqd's socket directory is dolq-<random>; the dev binary (dolqd-dev-<pid>) can share the same temp dir.
const socketDirs = (dir: string) => fs.readdirSync(dir).filter((f) => f.startsWith('dolq-'));

test('launches, renders and talks to its local backend', async () => {
  // userData holds settings/secrets; HOME is where dolqd keeps its history db;
  // TMPDIR is where dolqd puts its socket directory.
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dolq-e2e-home-')));
  // short, unresolved path: macOS caps unix socket paths at 103 characters
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dolq-t-'));
  const userData = path.join(home, 'userData');
  let bin = '';

  try {
    const app = await electron.launch({
      args: [root, `--user-data-dir=${userData}`, ...(process.env.CI ? ['--no-sandbox'] : [])],
      cwd: root,
      env: { ...process.env, ...goEnv(), HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), TMPDIR: tmp },
    });
    const errors: string[] = [];
    app.context().on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
    });
    app.context().on('weberror', (err) => errors.push(`pageerror: ${err.error().message}`));

    try {
      expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(userData);
      expect(await app.evaluate(() => process.versions.electron)).toMatch(/^42\./);

      const page = await app.firstWindow();
      await expect(page).toHaveTitle('Dolq');
      await expect(page.getByRole('button', { name: 'Add server' })).toBeVisible();

      // The rail's logo is an inlined image: the page's CSP must let it load.
      const dashboard = page.getByRole('button', { name: 'Dashboard' });
      await dashboard.click();
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
      expect(await dashboard.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

      // Waits for the spawned dolqd to report its socket, accept the token and answer.
      const status = await page.evaluate(() => (window as unknown as { irc: IrcApi }).irc.getStatus('smoke-test'));
      expect(status).toBe('disconnected');

      // The quit handler that stops dolqd is registered last during startup.
      await expect.poll(() => app.evaluate(({ app }) => app.listenerCount('before-quit'))).toBeGreaterThan(0);
      // the dev binary and dolqd's socket dir, both checked again after quit
      const [appTemp, pid] = await app.evaluate(({ app }) => [app.getPath('temp'), process.pid]);
      bin = path.join(String(appTemp), `dolqd-dev-${pid}`);
      expect(fs.existsSync(bin)).toBe(true);
      expect(socketDirs(tmp)).toHaveLength(1);

      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }

    // dolqd removes its socket dir on shutdown, and the app deletes the binary only after dolqd has exited.
    expect(socketDirs(tmp)).toEqual([]);
    expect(fs.existsSync(bin)).toBe(false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
