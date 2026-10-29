import { useEffect, useState } from 'react';
import type { Server } from '../types';
import { resolveHostPort } from '../utils/server';
import { ServerAppearance } from './ServerAppearance';
import { ServerFormFields } from './ServerFormFields';
import { Button } from './ui';
import { ViewPanel } from './ViewPanel';

export type EditServerForm = {
  name: string;
  initials: string;
  color: string;
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
  remember: boolean;
  connectOnStartup: boolean;
};

type Props = {
  server: Server;
  nick: string;
  saslUser: string;
  saslPass: string;
  onSave: (id: string, form: EditServerForm) => void;
  onCancel: () => void;
};

export function EditServerModal({ server, nick, saslUser, saslPass, onSave, onCancel }: Props) {
  const { host, port } = resolveHostPort(server);
  const [form, setForm] = useState<EditServerForm>({
    name: server.name,
    initials: server.initials ?? '',
    color: server.color ?? '',
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
    remember: server.rememberCredentials ?? false,
    connectOnStartup: server.connectOnStartup ?? false,
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.host.trim() || !form.nick.trim()) return;
    onSave(server.id, form);
  }

  return (
    <ViewPanel
      title="Edit server"
      description="Changes to Host, Port, TLS and Nickname apply the next time you connect, not to the current connection."
      width="md"
      onClose={onCancel}
      onSubmit={handleSubmit}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            Save
          </Button>
        </>
      }
    >
      <ServerAppearance
        serverId={server.id}
        name={form.name}
        initials={form.initials}
        color={form.color}
        onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
      />
      <ServerFormFields form={form} onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))} />
    </ViewPanel>
  );
}
