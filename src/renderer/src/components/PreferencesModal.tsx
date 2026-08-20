import { useEffect, useState } from 'react';
import type { Settings } from '../../../shared/ipc';
import type { Server } from '../types';
import { type KeybindAction } from '../store';
import { comboFromEvent } from '../utils/keybind';

const KEYBIND_LABELS: Record<KeybindAction, string> = {
  nextChannel: 'Next Channel',
  prevChannel: 'Previous Channel',
  closeChannel: 'Close Current Channel',
  toggleMute: 'Toggle Mute on Current Channel',
};

type Props = {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onCancel: () => void;
  // Unlike `settings` (main-process-owned, retentionDays needs a restart -
  // see src/main/settings.ts), these are plain renderer/zustand-store
  // values that apply live, so they're controlled inputs rather than part
  // of the form's own save/cancel flow.
  notificationsEnabled: boolean;
  onNotificationsEnabledChange: (enabled: boolean) => void;
  soundAlertsEnabled: boolean;
  onSoundAlertsEnabledChange: (enabled: boolean) => void;
  timestampFormat: '12h' | '24h';
  onTimestampFormatChange: (format: '12h' | '24h') => void;
  messageDensity: 'cozy' | 'compact';
  onMessageDensityChange: (density: 'cozy' | 'compact') => void;
  fontSize: 'small' | 'medium' | 'large';
  onFontSizeChange: (size: 'small' | 'medium' | 'large') => void;
  fontFamily: 'system' | 'serif' | 'monospace';
  onFontFamilyChange: (family: 'system' | 'serif' | 'monospace') => void;
  theme: 'dark' | 'light';
  onThemeChange: (theme: 'dark' | 'light') => void;
  // Ignored nicks are normally managed from a user's context menu
  // (UserList), but that only works while they're actually visible in a
  // shared channel - this is the only way to remove one once they aren't.
  servers: Server[];
  ignoredNicks: Record<string, string[]>;
  onRemoveIgnore: (serverId: string, nick: string) => void;
  // /alias shortcuts are defined/redefined by typing "/alias name ..." (see
  // App.tsx's handleSend) - this is view+remove only, same as Ignored Users
  // above, not a place to add one from scratch.
  aliases: Record<string, string>;
  onRemoveAlias: (name: string) => void;
  keybindings: Record<KeybindAction, string>;
  onKeybindingChange: (action: KeybindAction, combo: string) => void;
};

const inputClass =
  'w-full bg-[var(--dolq-bg-input)] border-0 rounded text-[var(--dolq-text)] text-[14px] px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#c792ea] placeholder:text-[var(--dolq-text-faint)]';
const labelClass =
  'flex flex-col gap-1.5 text-[11px] font-bold uppercase tracking-[0.5px] text-[var(--dolq-text-muted)]';

export function PreferencesModal({
  settings, onSave, onCancel, notificationsEnabled, onNotificationsEnabledChange,
  soundAlertsEnabled, onSoundAlertsEnabledChange,
  timestampFormat, onTimestampFormatChange, messageDensity, onMessageDensityChange,
  fontSize, onFontSizeChange, fontFamily, onFontFamilyChange, theme, onThemeChange,
  servers, ignoredNicks, onRemoveIgnore, aliases, onRemoveAlias, keybindings, onKeybindingChange,
}: Props) {
  const [trayEnabled, setTrayEnabled] = useState(settings.trayEnabled ?? true);
  const [retentionDays, setRetentionDays] = useState(String(settings.retentionDays));
  const [downloadDir, setDownloadDir] = useState(settings.downloadDir ?? '');
  const [dccPortMin, setDccPortMin] = useState(settings.dccPortMin ? String(settings.dccPortMin) : '');
  const [dccPortMax, setDccPortMax] = useState(settings.dccPortMax ? String(settings.dccPortMax) : '');
  const ignoredEntries = Object.entries(ignoredNicks).flatMap(([serverId, nicks]) =>
    nicks.map((nick) => ({ serverId, nick })),
  );
  const aliasEntries = Object.entries(aliases);
  // The action currently "listening" for its next keypress to rebind to -
  // null means no rebind row is in recording mode.
  const [recording, setRecording] = useState<KeybindAction | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (recording) {
        setRecording(null);
        return;
      }
      onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, recording]);

  useEffect(() => {
    if (!recording) return;
    const action = recording;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') return; // handled by the effect above
      e.preventDefault();
      const combo = comboFromEvent(e);
      if (!combo) return; // needs a modifier - keep listening
      // note: no duplicate-combo guard - binding two actions to the same
      // combo just makes App.tsx's lookup silently favor whichever comes
      // first in keybindings' key order. Add a collision check if that ever
      // surprises someone.
      onKeybindingChange(action, combo);
      setRecording(null);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, onKeybindingChange]);

  async function handleBrowseDownloadDir() {
    const chosen = await window.irc.chooseDirectory(downloadDir || undefined);
    if (chosen) setDownloadDir(chosen);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseInt(retentionDays, 10);
    let portMin = parseInt(dccPortMin, 10);
    let portMax = parseInt(dccPortMax, 10);
    // Anything that isn't a sane forward range just falls back to "unset"
    // (OS-picks-any-port, same as before this setting existed) rather than
    // blocking the save on a form error.
    if (!Number.isFinite(portMin) || !Number.isFinite(portMax) || portMin <= 0 || portMax < portMin) {
      portMin = 0;
      portMax = 0;
    }
    onSave({
      retentionDays: Number.isFinite(parsed) && parsed > 0 ? parsed : 0,
      downloadDir: downloadDir || undefined,
      dccPortMin: portMin || undefined,
      dccPortMax: portMax || undefined,
      trayEnabled,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="bg-[var(--dolq-bg-panel)] rounded-lg p-8 w-110 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[var(--dolq-text)] text-[22px] font-bold mb-1">Preferences</h2>
        <p className="text-[var(--dolq-text-muted)] text-[14px] mb-5">
          Applies to every server. Some settings need a restart to take effect.
        </p>

        <label className="flex items-center gap-2 text-[13px] text-[var(--dolq-text)] cursor-pointer select-none mb-3">
          <input
            type="checkbox"
            checked={notificationsEnabled}
            onChange={(e) => onNotificationsEnabledChange(e.target.checked)}
            className="accent-[#c792ea]"
          />
          Desktop notifications when mentioned in a channel you're not viewing
        </label>

        <label className="flex items-center gap-2 text-[13px] text-[var(--dolq-text)] cursor-pointer select-none mb-4">
          <input
            type="checkbox"
            checked={soundAlertsEnabled}
            onChange={(e) => onSoundAlertsEnabledChange(e.target.checked)}
            className="accent-[#c792ea]"
          />
          Play a sound on the same mentions - independent of the notification above
        </label>

        <div className="flex gap-3 mb-5">
          <label className={`${labelClass} flex-1`}>
            Timestamp Format
            <select
              className={inputClass}
              value={timestampFormat}
              onChange={(e) => onTimestampFormatChange(e.target.value as '12h' | '24h')}
            >
              <option value="12h">12-hour (2:30 PM)</option>
              <option value="24h">24-hour (14:30)</option>
            </select>
          </label>
          <label className={`${labelClass} flex-1`}>
            Message Density
            <select
              className={inputClass}
              value={messageDensity}
              onChange={(e) => onMessageDensityChange(e.target.value as 'cozy' | 'compact')}
            >
              <option value="cozy">Cozy</option>
              <option value="compact">Compact</option>
            </select>
          </label>
        </div>

        <div className="flex gap-3 mb-5">
          <label className={`${labelClass} flex-1`}>
            Font Size
            <select
              className={inputClass}
              value={fontSize}
              onChange={(e) => onFontSizeChange(e.target.value as 'small' | 'medium' | 'large')}
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </label>
          <label className={`${labelClass} flex-1`}>
            Font Family
            <select
              className={inputClass}
              value={fontFamily}
              onChange={(e) => onFontFamilyChange(e.target.value as 'system' | 'serif' | 'monospace')}
            >
              <option value="system">System Default</option>
              <option value="serif">Serif</option>
              <option value="monospace">Monospace</option>
            </select>
          </label>
        </div>

        <div className="flex gap-3 mb-5">
          <label className={`${labelClass} flex-1`}>
            Theme
            <select
              className={inputClass}
              value={theme}
              onChange={(e) => onThemeChange(e.target.value as 'dark' | 'light')}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <div className="flex-1" />
        </div>

        <div className="flex flex-col gap-1.5 mb-5">
          <span className="text-[11px] font-bold uppercase tracking-[0.5px] text-[var(--dolq-text-muted)]">
            Keybindings
          </span>
          <div className="flex flex-col gap-1">
            {(Object.keys(KEYBIND_LABELS) as KeybindAction[]).map((action) => (
              <div key={action} className="flex items-center justify-between gap-3 px-3 py-1.5 rounded bg-[var(--dolq-bg-input)]">
                <span className="text-[var(--dolq-text)] text-[13px]">{KEYBIND_LABELS[action]}</span>
                <button
                  type="button"
                  onClick={() => setRecording(action)}
                  className={`shrink-0 px-2.5 py-1 rounded text-[12px] font-medium border-0 cursor-pointer ${
                    recording === action
                      ? 'bg-[#c792ea] text-white'
                      : 'bg-[var(--dolq-bg-input)] text-[var(--dolq-text)] hover:bg-[var(--dolq-bg-hover)]'
                  }`}
                >
                  {recording === action ? 'Press keys… (Esc to cancel)' : keybindings[action]}
                </button>
              </div>
            ))}
          </div>
        </div>

        {ignoredEntries.length > 0 && (
          <div className="flex flex-col gap-1.5 mb-5">
            <span className="text-[11px] font-bold uppercase tracking-[0.5px] text-[var(--dolq-text-muted)]">
              Ignored Users
            </span>
            <div className="flex flex-col gap-1 max-h-32 overflow-y-auto scroll-thin pr-1">
              {ignoredEntries.map(({ serverId, nick }) => (
                <div key={`${serverId}:${nick}`} className="flex items-center justify-between gap-3 px-3 py-1.5 rounded bg-[var(--dolq-bg-input)]">
                  <span className="text-[var(--dolq-text)] text-[13px] truncate">
                    {nick} <span className="text-[var(--dolq-text-faint)]">on {servers.find((s) => s.id === serverId)?.name ?? serverId}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveIgnore(serverId, nick)}
                    className="shrink-0 text-[#ff5555] text-[12px] font-medium bg-transparent border-0 cursor-pointer hover:underline"
                  >
                    Unignore
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {aliasEntries.length > 0 && (
          <div className="flex flex-col gap-1.5 mb-5">
            <span className="text-[11px] font-bold uppercase tracking-[0.5px] text-[var(--dolq-text-muted)]">
              Aliases
            </span>
            <p className="text-[var(--dolq-text-faint)] text-[12px] -mt-0.5">
              Defined with <code>/alias name command</code> (<code>$1</code>, <code>$2</code>... for args,{' '}
              <code>$*</code> for all of them) - typing <code>/name</code> sends the expansion.
            </p>
            <div className="flex flex-col gap-1 max-h-32 overflow-y-auto scroll-thin pr-1 mt-1">
              {aliasEntries.map(([name, template]) => (
                <div key={name} className="flex items-center justify-between gap-3 px-3 py-1.5 rounded bg-[var(--dolq-bg-input)]">
                  <span className="text-[var(--dolq-text)] text-[13px] truncate">
                    <span className="font-semibold">/{name}</span>{' '}
                    <span className="text-[var(--dolq-text-faint)]">{template}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveAlias(name)}
                    className="shrink-0 text-[#ff5555] text-[12px] font-medium bg-transparent border-0 cursor-pointer hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-[13px] text-[var(--dolq-text)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={trayEnabled}
              onChange={(e) => setTrayEnabled(e.target.checked)}
              className="accent-[#c792ea]"
            />
            Show a tray/menu bar icon
          </label>

          <label className={labelClass}>
            History Retention (days)
            <input
              className={inputClass}
              type="number"
              value={retentionDays}
              onChange={(e) => setRetentionDays(e.target.value)}
              placeholder="0"
              min={0}
            />
          </label>
          <p className="text-[var(--dolq-text-faint)] text-[12px] -mt-2.5">
            How long to keep chat history. 0 keeps it forever. Takes effect the next time Dolq starts.
          </p>

          <label className={labelClass}>
            Download Directory
            <div className="flex gap-2">
              <input
                className={`${inputClass} flex-1`}
                type="text"
                value={downloadDir}
                onChange={(e) => setDownloadDir(e.target.value)}
                placeholder="Downloads (default)"
              />
              <button
                type="button"
                onClick={handleBrowseDownloadDir}
                className="shrink-0 px-3 rounded text-[var(--dolq-text)] text-[13px] font-medium bg-[var(--dolq-bg-input)] border-0 cursor-pointer hover:bg-[var(--dolq-bg-hover)]"
              >
                Browse…
              </button>
            </div>
          </label>
          <p className="text-[var(--dolq-text-faint)] text-[12px] -mt-2.5">
            Where XDCC downloads are saved. Empty uses the OS Downloads folder.
          </p>

          <div className="flex gap-3">
            <label className={`${labelClass} flex-1`}>
              DCC Port Range (min)
              <input
                className={inputClass}
                type="number"
                value={dccPortMin}
                onChange={(e) => setDccPortMin(e.target.value)}
                placeholder="Any"
                min={1}
                max={65535}
              />
            </label>
            <label className={`${labelClass} flex-1`}>
              DCC Port Range (max)
              <input
                className={inputClass}
                type="number"
                value={dccPortMax}
                onChange={(e) => setDccPortMax(e.target.value)}
                placeholder="Any"
                min={1}
                max={65535}
              />
            </label>
          </div>
          <p className="text-[var(--dolq-text-faint)] text-[12px] -mt-2.5">
            Ports DCC CHAT offers and passive XDCC downloads listen on. Leave both empty to let the OS pick any free
            port - set this if you're behind a router/firewall and want to forward a fixed range to receive them.
          </p>

          <div className="flex gap-3 justify-end mt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded text-[var(--dolq-text-muted)] text-[14px] font-medium bg-transparent border-0 cursor-pointer hover:text-[var(--dolq-text)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded bg-[#c792ea] text-white text-shadow-sm text-[14px] font-semibold border-0 cursor-pointer hover:bg-[#a579c2] transition-colors duration-150"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
