export type Transfer = { nick: string; filename: string; received: number; total: number };

type Props = {
  transfers: Record<string, Transfer>;
  onCancel: (id: string) => void;
};

// A minimal in-progress strip, not Milestone 4's "Transfer manager UI"
// (queue, speed, pause/resume) - just enough feedback that a multi-GB
// download isn't silently happening with nothing on screen to show it.
export function TransferStatus({ transfers, onCancel }: Props) {
  const entries = Object.entries(transfers);
  if (entries.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2 w-80">
      {entries.map(([id, t]) => {
        const pct = t.total > 0 ? Math.min(100, Math.round((t.received / t.total) * 100)) : 0;
        return (
          <div key={id} className="bg-[#1c1c1c] rounded-lg p-3 shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[13px] text-[#e6e6e6] truncate" title={t.filename}>
                {t.filename}
              </span>
              <button
                onClick={() => onCancel(id)}
                className="text-[#6b6b6b] hover:text-white bg-transparent border-0 cursor-pointer text-[13px] shrink-0"
              >
                ✕
              </button>
            </div>
            <div className="h-1.5 rounded-full bg-[#333] overflow-hidden">
              <div className="h-full bg-[#c792ea] transition-[width]" style={{ width: `${pct}%` }} />
            </div>
            <div className="text-[11px] text-[#6b6b6b] mt-1">
              {t.nick} · {pct}%
            </div>
          </div>
        );
      })}
    </div>
  );
}
