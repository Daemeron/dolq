import { useEffect, useState } from 'react';
import { useModalA11y } from '../hooks/useModalA11y';

type Props = {
  onIdentify: (password: string) => void;
  onDismiss: () => void;
};

const inputClass =
  'w-full bg-[var(--dolq-bg-input)] border-0 rounded text-[var(--dolq-text)] text-[14px] px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#c792ea] placeholder:text-[var(--dolq-text-faint)]';

export function NickServIdentifyModal({ onIdentify, onDismiss }: Props) {
  const [password, setPassword] = useState('');
  const dialogRef = useModalA11y<HTMLDivElement>();

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onDismiss}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nickserv-modal-title"
        tabIndex={-1}
        className="bg-(--dolq-bg-panel) rounded-lg p-6 w-90 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="nickserv-modal-title" className="text-(--dolq-text) text-[18px] font-bold mb-2">
          Identify with NickServ
        </h2>
        <p className="text-(--dolq-text-muted) text-[14px] mb-4">
          This nickname is registered. Enter its password to identify.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            className={inputClass}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
          />
          <p className="text-(--dolq-text-faint) text-[12px] -mt-2">
            Tip: set SASL credentials when connecting to identify automatically and skip this next time.
          </p>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onDismiss}
              className="px-4 py-2 rounded text-(--dolq-text-muted) text-[14px] font-medium bg-transparent border-0 cursor-pointer hover:text-(--dolq-text)"
            >
              Dismiss
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded bg-[#c792ea] text-white text-shadow-sm text-[14px] font-semibold border-0 cursor-pointer hover:bg-[#a579c2] transition-colors duration-150"
            >
              Identify
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
