import { useEffect } from 'react';
import { useModalA11y } from '../hooks/useModalA11y';

type Props = {
  nick: string;
  onAccept: () => void;
  onDecline: () => void;
};

export function DCCOfferModal({ nick, onAccept, onDecline }: Props) {
  const dialogRef = useModalA11y<HTMLDivElement>();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onDecline();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDecline]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onDecline}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dcc-offer-modal-title"
        tabIndex={-1}
        className="bg-(--dolq-bg-panel) rounded-lg p-6 w-90 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="dcc-offer-modal-title" className="text-(--dolq-text) text-[18px] font-bold mb-2">
          DCC Chat Request
        </h2>
        <p className="text-(--dolq-text-muted) text-[14px] mb-5">
          <span className="text-(--dolq-text) font-semibold">{nick}</span> wants to start a direct chat with you,
          outside the server. Only accept this from someone you trust - it connects straight to their address.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onDecline}
            className="px-4 py-2 rounded text-(--dolq-text-muted) text-[14px] font-medium bg-transparent border-0 cursor-pointer hover:text-(--dolq-text)"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="px-5 py-2 rounded bg-[#c792ea] text-white text-shadow-sm text-[14px] font-semibold border-0 cursor-pointer hover:bg-[#a579c2] transition-colors duration-150"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
