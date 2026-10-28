import { IRC_PORT, IRC_TLS_PORT } from '../../../shared/ipc';
import { RememberCredentials } from './RememberCredentials';
import { Card, Field, inputClass, Setting, Switch } from './ui';

export type ServerFields = {
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
  remember: boolean;
  connectOnStartup: boolean;
};

type Props<F extends ServerFields> = {
  form: F;
  onChange: (patch: Partial<F>) => void;
  /** Adds a server password field next to the nickname. */
  withPassword?: boolean;
  /** Rendered first, such as a network picker. */
  children?: React.ReactNode;
};

// Moving TLS on or off moves the port with it, unless the port was changed by hand.
export function portForSecure(currentPort: string, secure: boolean): string {
  const wasOnPreviousDefault = currentPort === String(secure ? IRC_PORT : IRC_TLS_PORT);
  return wasOnPreviousDefault ? String(secure ? IRC_TLS_PORT : IRC_PORT) : currentPort;
}

/** The fields the add and edit server dialogs share. */
export function ServerFormFields<F extends ServerFields & { password?: string }>({
  form,
  onChange,
  withPassword,
  children,
}: Props<F>) {
  const text = (field: keyof ServerFields | 'password') => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ [field]: e.target.value } as Partial<F>);

  return (
    <>
      {children}
      <Field label="Server Name">
        <input className={inputClass} value={form.name} onChange={text('name')} placeholder="My Server" />
      </Field>

      <div className="grid grid-cols-[1fr_110px] gap-3">
        <Field label="Host">
          <input className={inputClass} value={form.host} onChange={text('host')} placeholder="irc.libera.chat" />
        </Field>
        <Field label="Port">
          <input
            className={inputClass}
            type="number"
            value={form.port}
            onChange={text('port')}
            placeholder={String(IRC_PORT)}
            min={1}
            max={65535}
          />
        </Field>
      </div>

      <div className={withPassword ? 'grid grid-cols-2 gap-3' : ''}>
        <Field label="Nickname">
          <input className={inputClass} value={form.nick} onChange={text('nick')} placeholder="yournick" />
        </Field>
        {withPassword && (
          <Field label="Server Password">
            <input
              className={inputClass}
              type="password"
              value={form.password ?? ''}
              onChange={text('password')}
              placeholder="Optional"
            />
          </Field>
        )}
      </div>

      <Card>
        <Setting title="Use TLS" description="Encrypt the connection to the network.">
          <Switch
            checked={form.secure}
            onChange={(e) =>
              onChange({ secure: e.target.checked, port: portForSecure(form.port, e.target.checked) } as Partial<F>)
            }
          />
        </Setting>
        <Setting title="Connect on startup" description="Servers that are opted out wait until you click them.">
          <Switch
            checked={form.connectOnStartup}
            onChange={(e) => onChange({ connectOnStartup: e.target.checked } as Partial<F>)}
          />
        </Setting>
        <RememberCredentials checked={form.remember} onChange={(remember) => onChange({ remember } as Partial<F>)} />
      </Card>

      <details className="group flex flex-col gap-4">
        <summary className="cursor-pointer text-[13px] font-medium text-(--dolq-text-dim) select-none hover:text-(--dolq-text)">
          Advanced
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          <Field label="Alt Nicknames">
            <input
              className={inputClass}
              value={form.altNicks}
              onChange={text('altNicks')}
              placeholder="nick2, nick3 (tried in order if Nickname is taken)"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Username">
              <input
                className={inputClass}
                value={form.username}
                onChange={text('username')}
                placeholder={form.nick || 'defaults to Nickname'}
              />
            </Field>
            <Field label="Real Name">
              <input
                className={inputClass}
                value={form.realname}
                onChange={text('realname')}
                placeholder="Dolq IRC Client"
              />
            </Field>
          </div>
          <Field label="Autojoin Channels">
            <input
              className={inputClass}
              value={form.autojoinChannels}
              onChange={text('autojoinChannels')}
              placeholder="#general, #offtopic"
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-(--dolq-text-muted)">SASL Login</span>
            <p className="m-0 text-[12px] text-(--dolq-text-dim)">
              Optional. Authenticates your registered account before joining, instead of relying on NickServ IDENTIFY
              after connecting. Leave both blank to skip it.
            </p>
            <div className="mt-1 grid grid-cols-2 gap-3">
              <input
                className={inputClass}
                value={form.saslUser}
                onChange={text('saslUser')}
                placeholder="Account name"
                autoComplete="username"
              />
              <input
                className={inputClass}
                type="password"
                value={form.saslPass}
                onChange={text('saslPass')}
                placeholder="Account password"
                autoComplete="current-password"
              />
            </div>
          </div>
        </div>
      </details>
    </>
  );
}
