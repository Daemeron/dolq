import { useEffect, useState } from 'react';
import { Button, inputClass } from './ui';
import { ViewPanel } from './ViewPanel';

type Props = {
  onIdentify: (password: string) => void;
  onDismiss: () => void;
};

export function NickServIdentifyModal({ onIdentify, onDismiss }: Props) {
  const [password, setPassword] = useState('');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onDismiss();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    onIdentify(password);
  }

  return (
    <ViewPanel
      title="Identify with NickServ"
      description="This nickname is registered. Enter its password to identify."
      width="sm"
      onClose={onDismiss}
      onSubmit={handleSubmit}
      footer={
        <>
          <Button variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
          <Button variant="primary" type="submit">
            Identify
          </Button>
        </>
      }
    >
      <input
        className={inputClass}
        type="password"
        aria-label="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
      />
      <p className="m-0 text-[12px] text-(--dolq-text-dim)">
        Tip: set SASL credentials when connecting to identify automatically and skip this next time.
      </p>
    </ViewPanel>
  );
}
