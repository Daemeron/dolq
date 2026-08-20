import { useEffect } from 'react';
import type { IrcEvent } from '../../../shared/ipc';

type WhoisInfo = Extract<IrcEvent, { type: 'whois' }>;

type Props = {
  nick: string;
  result: WhoisInfo | null; // null while the request is still in flight
  onClose: () => void;
};

function formatIdle(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

const rowClass = 'flex gap-3 text-[14px]';
const labelClass = 'w-24 shrink-0 text-[var(--dolq-text-faint)]';

export function WhoisModal({ nick, result, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-[var(--dolq-bg-panel)] rounded-lg p-6 w-90 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[var(--dolq-text)] text-[18px] font-bold mb-4">{nick}</h2>

        {!result ? (
          <p className="text-[var(--dolq-text-dim)] text-[14px]">Looking up...</p>
        ) : result.noSuchNick ? (
          <p className="text-[var(--dolq-text-dim)] text-[14px]">No such nick - they may have quit or changed nick.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {result.user && result.host && (
              <div className={rowClass}>
                <span className={labelClass}>User</span>
                <span className="text-[var(--dolq-text)] truncate">{result.user}@{result.host}</span>
              </div>
            )}
            {result.realname && (
              <div className={rowClass}>
                <span className={labelClass}>Real Name</span>
                <span className="text-[var(--dolq-text)] truncate">{result.realname}</span>
              </div>
            )}
            {result.account && (
              <div className={rowClass}>
                <span className={labelClass}>Account</span>
                <span className="text-[var(--dolq-text)] truncate">{result.account}</span>
              </div>
            )}
            {result.server && (
              <div className={rowClass}>
                <span className={labelClass}>Server</span>
                <span className="text-[var(--dolq-text)] truncate" title={result.serverInfo}>{result.server}</span>
              </div>
            )}
            {result.channels && result.channels.length > 0 && (
              <div className={rowClass}>
                <span className={labelClass}>Channels</span>
                <span className="text-[var(--dolq-text)] truncate">{result.channels.join(', ')}</span>
              </div>
            )}
            {result.idleSeconds !== undefined && (
              <div className={rowClass}>
                <span className={labelClass}>Idle</span>
                <span className="text-[var(--dolq-text)]">{formatIdle(result.idleSeconds)}</span>
              </div>
            )}
            {result.away && (
              <div className={rowClass}>
                <span className={labelClass}>Away</span>
                <span className="text-[var(--dolq-text)] truncate">{result.away}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-[var(--dolq-text-muted)] text-[14px] font-medium bg-transparent border-0 cursor-pointer hover:text-[var(--dolq-text)]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
