import { useState } from 'react';

type Props = {
  onIdentify: (password: string) => void;
  onDismiss: () => void;
};

const inputClass =
  'w-full bg-[#333333] border-0 rounded text-[#e6e6e6] text-[14px] px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#c792ea] placeholder:text-[#6b6b6b]';

// NickServ just told us this nick needs identifying (see
// utils/nickserv.ts) - a one-click shortcut for `/msg NickServ identify
// <password>` instead of typing the whole thing out by hand. Nothing here
// is remembered anywhere: SASL (Connect form's "Advanced" section) is
// already this app's real answer to "don't ask me every time" - if that's
// set up, this prompt wouldn't even fire, since SASL identifies before
// registration completes.
export function NickServIdentifyModal({ onIdentify, onDismiss }: Props) {
  const [password, setPassword] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    onIdentify(password);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onDismiss}>
      <div
        className="bg-[#1c1c1c] rounded-lg p-6 w-90 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-white text-[18px] font-bold mb-2">Identify with NickServ</h2>
        <p className="text-[#b0b0b0] text-[14px] mb-4">
          This nickname is registered. Enter its password to identify.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            className={inputClass}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
          />
          <p className="text-[#6b6b6b] text-[12px] -mt-2">
            Tip: set SASL credentials when connecting to identify automatically and skip this next time.
          </p>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onDismiss}
              className="px-4 py-2 rounded text-[#b0b0b0] text-[14px] font-medium bg-transparent border-0 cursor-pointer hover:text-white"
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
