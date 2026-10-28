import { useEffect, useState } from 'react';

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
    <div className="flex flex-col gap-1">
      <label
        className={`flex items-center gap-2 text-[13px] text-(--dolq-text) select-none ${
          available ? 'cursor-pointer' : 'opacity-60'
        }`}
      >
        <input
          type="checkbox"
          checked={checked && available}
          disabled={!available}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-(--dolq-accent)"
        />
        Remember passwords on this device
      </label>
      <p className="text-(--dolq-text-faint) text-[12px]">
        {available
          ? "Stored encrypted with your operating system's keychain, so the server can connect with them after a restart."
          : 'Unavailable: no secure OS keychain was found, so passwords are only kept until you quit.'}
      </p>
    </div>
  );
}
