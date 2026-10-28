import { useEffect, useState } from 'react';
import { IRC_TLS_PORT } from '../../../shared/ipc';
import type { ServerPreset } from '../data/servers';
import { ServerFormFields } from './ServerFormFields';
import { Button, Field, inputClass } from './ui';
import { ViewPanel } from './ViewPanel';

type ConnectForm = {
  name: string;
  host: string;
  port: string;
  nick: string;
  password: string;
  remember: boolean;
  secure: boolean;
  saslUser: string;
  saslPass: string;
  altNicks: string;
  username: string;
  realname: string;
  autojoinChannels: string;
  connectOnStartup: boolean;
};

function parseList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

type Props = {
  presets: ServerPreset[];
  nickMap: Record<string, string>;
  onConnect: (form: ConnectForm) => void;
  onCancel: () => void;
  initial?: { host: string; port: number; secure: boolean; channel?: string };
  /** A network to start on, by preset id. */
  initialPresetId?: string;
};

const DEFAULTS: ConnectForm = {
  name: '',
  host: '',
  port: String(IRC_TLS_PORT),
  nick: 'dolq_user',
  password: '',
  remember: false,
  secure: true,
  saslUser: '',
  saslPass: '',
  altNicks: '',
  username: '',
  realname: '',
  autojoinChannels: '',
  connectOnStartup: false,
};

export function ConnectModal({ presets, nickMap, onConnect, onCancel, initial, initialPresetId }: Props) {
  const startPreset = presets.find((p) => p.id === initialPresetId);
  const [form, setForm] = useState<ConnectForm>(() =>
    startPreset
      ? {
          ...DEFAULTS,
          name: startPreset.name,
          host: startPreset.host,
          port: String(startPreset.port),
          nick: nickMap[startPreset.id] ?? DEFAULTS.nick,
          secure: startPreset.secure,
        }
      : initial
        ? {
            ...DEFAULTS,
            name: initial.host,
            host: initial.host,
            port: String(initial.port),
            secure: initial.secure,
            autojoinChannels: initial.channel ?? '',
          }
        : DEFAULTS,
  );
  const [presetId, setPresetId] = useState(startPreset?.id ?? '');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function pickPreset(id: string) {
    setPresetId(id);
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    setForm((prev) => ({
      ...prev,
      name: preset.name,
      host: preset.host,
      port: String(preset.port),
      nick: nickMap[preset.id] ?? prev.nick,
      secure: preset.secure,
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.host.trim() || !form.nick.trim()) return;
    onConnect(form);
  }

  return (
    <ViewPanel
      title="Add a server"
      description="Connect to an IRC network. Credentials are stored encrypted on this device."
      width="md"
      onClose={onCancel}
      onSubmit={handleSubmit}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            Connect
          </Button>
        </>
      }
    >
      <ServerFormFields form={form} onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))} withPassword>
        <Field label="Network">
          <select className={inputClass} value={presetId} onChange={(e) => pickPreset(e.target.value)}>
            <option value="">Custom…</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </Field>
      </ServerFormFields>
    </ViewPanel>
  );
}

export type { ConnectForm };
export { parseList };
