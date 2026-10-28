import { useEffect, useState } from 'react';
import { Setting, Switch } from './ui';

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
};

// Opt-in "remember" for the server and SASL passwords. They are encrypted by
// the main process with the OS keystore; this only renders the choice.
export function RememberCredentials({ checked, onChange }: Props) {
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let live = true;
    window.irc
      .secretsAvailable()
      .then((ok) => live && setAvailable(ok))
      .catch(() => live && setAvailable(false));
    return () => {
      live = false;
    };
  }, []);

  return (
    <Setting
      title="Remember passwords on this device"
      description={
        available
          ? "Stored encrypted with your operating system's keychain, so the server can connect with them after a restart."
          : 'Unavailable: no secure OS keychain was found, so passwords are only kept until you quit.'
      }
    >
      <Switch checked={checked && available} disabled={!available} onChange={(e) => onChange(e.target.checked)} />
    </Setting>
  );
}
