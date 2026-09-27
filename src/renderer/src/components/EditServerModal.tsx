import { useState } from 'react';
import { IRC_PORT, IRC_TLS_PORT } from '../../../shared/ipc';
import type { Server } from '../types';
import { resolveHostPort } from '../utils/server';
import { ViewPanel } from './ViewPanel';

export type EditServerForm = {
  name: string;
  host: string;
  port: string;
  secure: boolean;
  nick: string;
  altNicks: string;
  username: string;
  realname: string;
  autojoinChannels: string;
  saslUser: string;
  saslPass: string;
};

type Props = {
  server: Server;
  nick: string;
  saslUser: string;
  saslPass: string;
  onSave: (id: string, form: EditServerForm) => void;
  onCancel: () => void;
};

const inputClass =
  'w-full bg-[var(--dolq-bg-input)] border-0 rounded text-[var(--dolq-text)] text-[14px] px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#c792ea] placeholder:text-[var(--dolq-text-faint)]';
const labelClass =
  'flex flex-col gap-1.5 text-[11px] font-bold uppercase tracking-[0.5px] text-[var(--dolq-text-muted)]';

export function EditServerModal({ server, nick, saslUser, saslPass, onSave, onCancel }: Props) {
  const { host, port } = resolveHostPort(server);
  const [form, setForm] = useState<EditServerForm>({
    name: server.name,
    host,
    port: String(port),
    secure: server.secure,
    nick,
    altNicks: (server.altNicks ?? []).join(', '),
    username: server.username ?? '',
    realname: server.realname ?? '',
    autojoinChannels: (server.autojoinChannels ?? []).join(', '),
    saslUser,
    saslPass,
  });

  function set(field: keyof EditServerForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  function toggleSecure(e: React.ChangeEvent<HTMLInputElement>) {
    const secure = e.target.checked;
    setForm((prev) => {
      const wasOnPreviousDefault = prev.port === String(secure ? IRC_PORT : IRC_TLS_PORT);
      const port = wasOnPreviousDefault ? String(secure ? IRC_TLS_PORT : IRC_PORT) : prev.port;
      return { ...prev, secure, port };
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.host.trim() || !form.nick.trim()) return;
    onSave(server.id, form);
  }

  return (
    <ViewPanel title="Edit Server" onClose={onCancel}>
      <div className="max-w-110 flex flex-col gap-4">
        <p className="text-(--dolq-text-muted) text-[14px] -mt-1">
          Changes to Host/Port/SSL/Nickname apply the next time you connect, not to the current connection.
        </p>

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

          <label className="flex items-center gap-2 text-[13px] text-(--dolq-text) cursor-pointer select-none">
            <input type="checkbox" checked={form.secure} onChange={toggleSecure} className="accent-[#c792ea]" />
            Use SSL/TLS
          </label>

          <label className={labelClass}>
            Nickname
            <input className={inputClass} value={form.nick} onChange={set('nick')} placeholder="yournick" />
          </label>

          <label className={labelClass}>
            Alt Nicknames
            <input
              className={inputClass}
              value={form.altNicks}
              onChange={set('altNicks')}
              placeholder="nick2, nick3 (tried in order if Nickname is taken)"
            />
          </label>

          <div className="flex gap-3">
            <label className={`${labelClass} flex-1`}>
              Username
              <input
                className={inputClass}
                value={form.username}
                onChange={set('username')}
                placeholder={form.nick || 'defaults to Nickname'}
              />
            </label>
            <label className={`${labelClass} flex-1`}>
              Real Name
              <input
                className={inputClass}
                value={form.realname}
                onChange={set('realname')}
                placeholder="Dolq IRC Client"
              />
            </label>
          </div>

          <label className={labelClass}>
            Autojoin Channels
            <input
              className={inputClass}
              value={form.autojoinChannels}
              onChange={set('autojoinChannels')}
              placeholder="#general, #offtopic"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.5px] text-(--dolq-text-muted)">
              SASL Login
            </span>
            <div className="flex gap-3 mt-1">
              <input
                className={`${inputClass} flex-1`}
                value={form.saslUser}
                onChange={set('saslUser')}
                placeholder="Account name"
                autoComplete="username"
              />
              <input
                className={`${inputClass} flex-1`}
                type="password"
                value={form.saslPass}
                onChange={set('saslPass')}
                placeholder="Account password"
                autoComplete="current-password"
              />
            </div>
          </div>

          <div className="flex gap-3 justify-end mt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded text-(--dolq-text-muted) text-[14px] font-medium bg-transparent border-0 cursor-pointer hover:text-(--dolq-text)"
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
    </ViewPanel>
  );
}
