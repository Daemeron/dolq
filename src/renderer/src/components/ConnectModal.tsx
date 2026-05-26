import { useEffect, useState } from 'react';

type ConnectForm = {
  name: string;
  host: string;
  port: string;
  nick: string;
  password: string;
};

type Props = {
  onConnect: (form: ConnectForm) => void;
  onCancel: () => void;
};

const DEFAULTS: ConnectForm = {
  name: 'Localhost',
  host: 'localhost',
  port: '6667',
  nick: 'reecord_user',
  password: '',
};

const inputClass =
  'w-full bg-[#40444b] border-0 rounded text-[#dcddde] text-[14px] px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#7289da] placeholder:text-[#72767d]';
const labelClass =
  'flex flex-col gap-1.5 text-[11px] font-bold uppercase tracking-[0.5px] text-[#b9bbbe]';

export function ConnectModal({ onConnect, onCancel }: Props) {
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
        className="bg-[#2f3136] rounded-lg p-8 w-[440px] shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-white text-[22px] font-bold mb-1">Add a Server</h2>
        <p className="text-[#b9bbbe] text-[14px] mb-6">Connect to an IRC server.</p>

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
                placeholder="6667"
                min={1}
                max={65535}
              />
            </label>
          </div>

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
              className="px-4 py-2 rounded text-[#b9bbbe] text-[14px] font-medium bg-transparent border-0 cursor-pointer hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded bg-[#7289da] text-white text-[14px] font-semibold border-0 cursor-pointer hover:bg-[#677bc4] transition-colors duration-150"
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
