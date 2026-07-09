import { useEffect, useState } from 'react';
import type { ServerPreset } from '../data/servers';
import { IRC_PORT, IRC_TLS_PORT } from '../../../shared/ipc';

type ConnectForm = {
  name: string;
  host: string;
  port: string;
  nick: string;
  password: string;
  secure: boolean;
};

type Props = {
  presets: ServerPreset[];
  nickMap: Record<string, string>;
  onConnect: (form: ConnectForm) => void;
  onCancel: () => void;
};

const DEFAULTS: ConnectForm = {
  name: 'Localhost',
  host: 'localhost',
  port: String(IRC_TLS_PORT),
  nick: 'dolq_user',
  password: '',
  secure: true,
};

const inputClass =
  'w-full bg-[#333333] border-0 rounded text-[#e6e6e6] text-[14px] px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#c792ea] placeholder:text-[#6b6b6b]';
const labelClass =
  'flex flex-col gap-1.5 text-[11px] font-bold uppercase tracking-[0.5px] text-[#b0b0b0]';

export function ConnectModal({ presets, nickMap, onConnect, onCancel }: Props) {
  const [form, setForm] = useState<ConnectForm>(DEFAULTS);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function set(field: keyof ConnectForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  function pickPreset(preset: ServerPreset) {
    setForm((prev) => ({
      ...prev,
      name: preset.name,
      host: preset.host,
      port: String(preset.port),
      nick: nickMap[preset.id] ?? prev.nick,
      secure: preset.secure,
    }));
  }

  function toggleSecure(e: React.ChangeEvent<HTMLInputElement>) {
    const secure = e.target.checked;
    setForm((prev) => {
      // Only follow the port along if it was still sitting on the default for the
      // protocol being switched away from - a server can run TLS on a non-standard
      // port, so once the user has typed their own value, leave it alone.
      const wasOnPreviousDefault = prev.port === String(secure ? IRC_PORT : IRC_TLS_PORT);
      const port = wasOnPreviousDefault ? String(secure ? IRC_TLS_PORT : IRC_PORT) : prev.port;
      return { ...prev, secure, port };
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.host.trim() || !form.nick.trim()) return;
    onConnect(form);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onCancel}
    >
      <div
        className="bg-[#1c1c1c] rounded-lg p-8 w-110 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-white text-[22px] font-bold mb-1">Add a Server</h2>
        <p className="text-[#b0b0b0] text-[14px] mb-3">Pick a server, or fill in a custom one below.</p>

        <div className="flex flex-col gap-1 max-h-40 overflow-y-auto scroll-thin mb-5 pr-1">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => pickPreset(preset)}
              className="flex items-baseline justify-between gap-3 px-3 py-2 rounded bg-[#333333] border-0 text-left cursor-pointer hover:bg-[#3d3d3d]"
            >
              <span className="text-[#e6e6e6] text-[14px] font-medium">{preset.name}</span>
              <span className="text-[#6b6b6b] text-[12px] shrink-0">{preset.host}:{preset.port}</span>
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className={labelClass}>
            Server Name
            <input className={inputClass} value={form.name} onChange={set('name')} placeholder="My Server" />
          </label>

          <div className="flex gap-3">
            <label className={`${labelClass} flex-1`}>
              Host
              <input className={inputClass} value={form.host} onChange={set('host')} placeholder="irc.libera.chat" />
            </label>
            <label className={labelClass} style={{ width: '90px' }}>
              Port
              <input
                className={inputClass}
                type="number"
                value={form.port}
                onChange={set('port')}
                placeholder={String(IRC_PORT)}
                min={1}
                max={65535}
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-[13px] text-[#e6e6e6] cursor-pointer select-none">
            <input type="checkbox" checked={form.secure} onChange={toggleSecure} className="accent-[#c792ea]" />
            Use SSL/TLS
          </label>

          <label className={labelClass}>
            Nickname
            <input className={inputClass} value={form.nick} onChange={set('nick')} placeholder="yournick" />
          </label>

          <label className={labelClass}>
            Server Password
            <input
              className={inputClass}
              type="password"
              value={form.password}
              onChange={set('password')}
              placeholder="Optional"
            />
          </label>

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
              Connect
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export type { ConnectForm };
