import { useEffect, useState } from 'react';
import type { Settings } from '../../../shared/ipc';
import type { Server } from '../types';

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
  timestampFormat: '12h' | '24h';
  onTimestampFormatChange: (format: '12h' | '24h') => void;
  messageDensity: 'cozy' | 'compact';
  onMessageDensityChange: (density: 'cozy' | 'compact') => void;
  // Ignored nicks are normally managed from a user's context menu
  // (UserList), but that only works while they're actually visible in a
  // shared channel - this is the only way to remove one once they aren't.
  servers: Server[];
  ignoredNicks: Record<string, string[]>;
  onRemoveIgnore: (serverId: string, nick: string) => void;
};

const inputClass =
  'w-full bg-[#333333] border-0 rounded text-[#e6e6e6] text-[14px] px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#c792ea] placeholder:text-[#6b6b6b]';
const labelClass =
  'flex flex-col gap-1.5 text-[11px] font-bold uppercase tracking-[0.5px] text-[#b0b0b0]';

export function PreferencesModal({
  settings, onSave, onCancel, notificationsEnabled, onNotificationsEnabledChange,
  timestampFormat, onTimestampFormatChange, messageDensity, onMessageDensityChange,
  servers, ignoredNicks, onRemoveIgnore,
}: Props) {
  const [retentionDays, setRetentionDays] = useState(String(settings.retentionDays));
  const ignoredEntries = Object.entries(ignoredNicks).flatMap(([serverId, nicks]) =>
    nicks.map((nick) => ({ serverId, nick })),
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseInt(retentionDays, 10);
    onSave({ retentionDays: Number.isFinite(parsed) && parsed > 0 ? parsed : 0 });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="bg-[#1c1c1c] rounded-lg p-8 w-110 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-white text-[22px] font-bold mb-1">Preferences</h2>
        <p className="text-[#b0b0b0] text-[14px] mb-5">
          Applies to every server. Some settings need a restart to take effect.
        </p>

        <label className="flex items-center gap-2 text-[13px] text-[#e6e6e6] cursor-pointer select-none mb-4">
          <input
            type="checkbox"
            checked={notificationsEnabled}
            onChange={(e) => onNotificationsEnabledChange(e.target.checked)}
            className="accent-[#c792ea]"
          />
          Desktop notifications when mentioned in a channel you're not viewing
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

        {ignoredEntries.length > 0 && (
          <div className="flex flex-col gap-1.5 mb-5">
            <span className="text-[11px] font-bold uppercase tracking-[0.5px] text-[#b0b0b0]">
              Ignored Users
            </span>
            <div className="flex flex-col gap-1 max-h-32 overflow-y-auto scroll-thin pr-1">
              {ignoredEntries.map(({ serverId, nick }) => (
                <div key={`${serverId}:${nick}`} className="flex items-center justify-between gap-3 px-3 py-1.5 rounded bg-[#333333]">
                  <span className="text-[#e6e6e6] text-[13px] truncate">
                    {nick} <span className="text-[#6b6b6b]">on {servers.find((s) => s.id === serverId)?.name ?? serverId}</span>
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

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
          <p className="text-[#6b6b6b] text-[12px] -mt-2.5">
            How long to keep chat history. 0 keeps it forever. Takes effect the next time Dolq starts.
          </p>

          <div className="flex gap-3 justify-end mt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded text-[#b0b0b0] text-[14px] font-medium bg-transparent border-0 cursor-pointer hover:text-white"
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
