import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '../shared/ipc';
import { CHECK_EVERY_MS, FIRST_CHECK_MS, startUpdater, type Updater } from './updater';

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  checkForUpdates = vi.fn(async () => null);
  downloadUpdate = vi.fn(async () => []);
  quitAndInstall = vi.fn();
}

function setup(canInstall: boolean, opts: { enabled?: () => boolean; autoDownload?: () => boolean } = {}) {
  const fake = new FakeUpdater();
  const statuses: UpdateStatus[] = [];
  const updates = startUpdater({
    updater: fake as unknown as Updater,
    canInstall,
    enabled: opts.enabled ?? (() => true),
    autoDownload: opts.autoDownload ?? (() => false),
    onStatus: (s) => statuses.push(s),
  });
  return { fake, statuses, updates };
}

const found = (version = '0.8.0') => ({ version });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('startUpdater', () => {
  it('never downloads by itself, and installs a downloaded version when Dolq quits where it can', () => {
    expect(setup(true).fake.autoDownload).toBe(false);
    expect(setup(true).fake.autoInstallOnAppQuit).toBe(true);
    expect(setup(false).fake.autoInstallOnAppQuit).toBe(false);
  });

  it('says a version is available and waits to be asked', () => {
    const { fake, statuses } = setup(true);
    fake.emit('update-available', found());
    expect(statuses).toEqual([{ state: 'available', version: '0.8.0', canInstall: true }]);
    expect(fake.downloadUpdate).not.toHaveBeenCalled();
  });

  it('downloads when the notice is clicked, then says once the version is ready', () => {
    const { fake, statuses, updates } = setup(true);
    fake.emit('update-available', found());
    updates.download();
    expect(fake.downloadUpdate).toHaveBeenCalledTimes(1);
    fake.emit('update-downloaded', found());
    expect(statuses.map((s) => s.state)).toEqual(['available', 'downloading', 'downloaded']);
  });

  it('downloads at once when the preference says so', () => {
    const { fake, statuses } = setup(true, { autoDownload: () => true });
    fake.emit('update-available', found());
    expect(statuses.map((s) => s.state)).toEqual(['available', 'downloading']);
    expect(fake.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it('only says a version is out where it cannot install, whatever the preference', () => {
    const { fake, statuses, updates } = setup(false, { autoDownload: () => true });
    fake.emit('update-available', found());
    updates.download();
    expect(statuses).toEqual([{ state: 'available', version: '0.8.0', canInstall: false }]);
    expect(fake.downloadUpdate).not.toHaveBeenCalled();
  });

  it('does not take a download in progress or a finished one back to available on the next check', () => {
    const { fake, statuses, updates } = setup(true);
    fake.emit('update-available', found());
    updates.download();
    fake.emit('update-available', found());
    fake.emit('update-downloaded', found());
    fake.emit('update-available', found());
    expect(statuses.map((s) => s.state)).toEqual(['available', 'downloading', 'downloaded']);
  });

  it('offers a newer version than the one already downloaded', () => {
    const { fake, statuses } = setup(true);
    fake.emit('update-downloaded', found('0.8.0'));
    fake.emit('update-available', found('0.9.0'));
    expect(statuses.at(-1)).toEqual({ state: 'available', version: '0.9.0', canInstall: true });
  });

  it('offers the version again when a download fails', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fake, statuses, updates } = setup(true);
    fake.emit('update-available', found());
    updates.download();
    fake.emit('error', new Error('connection reset'));
    expect(statuses.map((s) => s.state)).toEqual(['available', 'downloading', 'available']);
    log.mockRestore();
  });

  it('only download() on a found version does anything', () => {
    const { fake, updates } = setup(true);
    updates.download();
    expect(fake.downloadUpdate).not.toHaveBeenCalled();
  });

  it('installs only a version that has been downloaded', () => {
    const { fake, updates } = setup(true);
    fake.emit('update-available', found());
    updates.install();
    expect(fake.quitAndInstall).not.toHaveBeenCalled();
    fake.emit('update-downloaded', found());
    updates.install();
    expect(fake.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('checks shortly after launch and then every few hours', async () => {
    const { fake } = setup(true);
    expect(fake.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('does not check while the preference is off, and starts again when it is switched back on', async () => {
    let on = false;
    const { fake } = setup(true, { enabled: () => on });
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(fake.checkForUpdates).not.toHaveBeenCalled();
    on = true;
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('logs a failed check and keeps checking', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fake } = setup(true);
    fake.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    fake.emit('error', new Error('offline'));
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(log).toHaveBeenCalledWith('update check failed:', expect.objectContaining({ message: 'offline' }));
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  it('stops checking when told to', async () => {
    const { fake, updates } = setup(true);
    updates.stop();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(fake.checkForUpdates).not.toHaveBeenCalled();
  });
});
