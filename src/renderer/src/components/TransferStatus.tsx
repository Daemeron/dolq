export type Transfer = {
  nick: string;
  filename: string;
  received: number;
  total: number;
  done?: boolean;
  error?: string;
  paused?: boolean;
  // Only set once at least one XDCCTRANSFER has arrived to measure a delta
  // against - see App.tsx's speed bookkeeping.
  speedBps?: number;
};

type Props = {
  transfers: Record<string, Transfer>;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  // Removes a finished (done or errored) entry from the list - cancel only
  // applies to one still in progress.
  onDismiss: (id: string) => void;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

// The transfer manager: every transfer xdccAccept has started, active or
// finished, in one queue - not removed the moment it completes/fails, so
// there's somewhere to see what actually happened (see the "Downloaded .../
// Download failed" chat line App.tsx also posts, which scrolls away).
export function TransferStatus({ transfers, onPause, onResume, onCancel, onDismiss }: Props) {
  const entries = Object.entries(transfers);
  if (entries.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2 w-80 max-h-[70vh] overflow-y-auto scroll-thin">
      {entries.map(([id, t]) => {
        const pct = t.total > 0 ? Math.min(100, Math.round((t.received / t.total) * 100)) : 0;
        const finished = t.done || !!t.error;
        return (
          <div key={id} className="bg-[#1c1c1c] rounded-lg p-3 shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[13px] text-[#e6e6e6] truncate" title={t.filename}>
                {t.filename}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {!finished && (
                  <button
                    onClick={() => (t.paused ? onResume(id) : onPause(id))}
                    className="text-[#6b6b6b] hover:text-white bg-transparent border-0 cursor-pointer text-[13px]"
                    title={t.paused ? 'Resume' : 'Pause'}
                  >
                    {t.paused ? '▶' : '⏸'}
                  </button>
                )}
                <button
                  onClick={() => (finished ? onDismiss(id) : onCancel(id))}
                  className="text-[#6b6b6b] hover:text-white bg-transparent border-0 cursor-pointer text-[13px]"
                  title={finished ? 'Dismiss' : 'Cancel'}
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-[#333] overflow-hidden">
              <div
                className={`h-full transition-[width] ${t.error ? 'bg-[#ff5555]' : 'bg-[#c792ea]'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="text-[11px] text-[#6b6b6b] mt-1">
              {t.error ? (
                <span className="text-[#ff5555]">Failed: {t.error}</span>
              ) : t.done ? (
                'Done'
              ) : t.paused ? (
                `${t.nick} · ${pct}% · paused`
              ) : (
                `${t.nick} · ${pct}%${t.speedBps ? ` · ${formatBytes(t.speedBps)}/s` : ''}`
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
