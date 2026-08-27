import { useState } from 'react';
import type { Server } from '../types';
import { IRC_PORT, IRC_TLS_PORT } from '../../../shared/ipc';
import { useModalA11y } from '../hooks/useModalA11y';
import { resolveHostPort } from '../utils/server';

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

// Same field set ConnectModal's Advanced section already collects at
// creation time - this is the "edit later" path that never existed for any
// of it (see ROADMAP's "Per-server identity defaults": create-only was a
// deliberate v1 scope cut, not a design decision worth keeping forever).
// Deliberately drops ConnectModal's "Server Password" field rather than
// carrying it forward - that field is already disconnected from anything
// (PASS is hardcoded in the handshake, a separate pre-existing bug), so
// there's nothing to edit there.
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
  const dialogRef = useModalA11y<HTMLDivElement>();

  function set(field: keyof EditServerForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-server-modal-title"
        tabIndex={-1}
        className="bg-[var(--dolq-bg-panel)] rounded-lg p-8 w-110 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="edit-server-modal-title" className="text-[var(--dolq-text)] text-[22px] font-bold mb-1">
          Edit Server
        </h2>
        <p className="text-[var(--dolq-text-muted)] text-[14px] mb-5">
          Changes to Host/Port/SSL/Nickname apply the next time you connect, not to the
          current connection.
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

          <label className="flex items-center gap-2 text-[13px] text-[var(--dolq-text)] cursor-pointer select-none">
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
              <input className={inputClass} value={form.username} onChange={set('username')} placeholder={form.nick || 'defaults to Nickname'} />
            </label>
            <label className={`${labelClass} flex-1`}>
              Real Name
              <input className={inputClass} value={form.realname} onChange={set('realname')} placeholder="Dolq IRC Client" />
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
            <span className="text-[11px] font-bold uppercase tracking-[0.5px] text-[var(--dolq-text-muted)]">
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
