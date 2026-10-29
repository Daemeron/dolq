import type { AppUpdater } from 'electron-updater';
import type { UpdateStatus } from '../shared/ipc';

export const FIRST_CHECK_MS = 20_000;
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

// The part of electron-updater used here, so a test can stand in for it.
export type Updater = Pick<
  AppUpdater,
  'on' | 'checkForUpdates' | 'downloadUpdate' | 'quitAndInstall' | 'autoDownload' | 'autoInstallOnAppQuit'
>;

type Options = {
  updater: Updater;
  /** Dolq can replace itself here (Windows, an AppImage). Elsewhere it only says that a version is out. */
  canInstall: boolean;
  /** Asked before every check, so switching the preference off takes effect at once. */
  enabled: () => boolean;
  /** Fetch a found version straight away instead of waiting for download(). */
  autoDownload: () => boolean;
  onStatus: (status: UpdateStatus) => void;
};

/**
 * Looks for a new version a little after launch and then every few hours, and says when there is one. Nothing is
 * downloaded until download() is called (the user clicked the notice) or the preference to do it automatically is on;
 * a downloaded version installs when Dolq quits, or at once on install().
 */
export function startUpdater({ updater, canInstall, enabled, autoDownload, onStatus }: Options) {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = canInstall;

  let current: UpdateStatus | null = null;
  const report = (state: UpdateStatus['state'], version: string) => {
    current = { state, version, canInstall };
    onStatus(current);
  };

  const download = () => {
    if (!canInstall || current?.state !== 'available') return;
    report('downloading', current.version);
    // A failure is reported through the 'error' event below.
    updater.downloadUpdate().catch(() => {});
  };

  updater.on('update-available', (info) => {
    // Every check finds the same version again; do not take a download in progress or a finished one back a step.
    if (current?.version === info.version && current.state !== 'available') return;
    report('available', info.version);
    if (autoDownload()) download();
  });
  updater.on('update-downloaded', (info) => report('downloaded', info.version));
  updater.on('error', (err) => {
    console.error('update check failed:', err);
    // A download that broke goes back to being offered.
    if (current?.state === 'downloading') report('available', current.version);
  });

  const check = () => {
    if (!enabled()) return;
    updater.checkForUpdates().catch(() => {});
  };
  const first = setTimeout(check, FIRST_CHECK_MS);
  const every = setInterval(check, CHECK_EVERY_MS);
  first.unref();
  every.unref();

  return {
    download,
    install: () => {
      if (current?.state === 'downloaded') updater.quitAndInstall();
    },
    stop: () => {
      clearTimeout(first);
      clearInterval(every);
    },
  };
}
