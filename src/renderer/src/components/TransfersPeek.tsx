import { activeLine, transferPercent } from '../utils/transferLine';
import type { Transfer } from './TransferStatus';

const SHOWN = 4;

/** What is transferring right now, as a small card under the Transfers button. */
export function TransfersPeek({ transfers }: { transfers: Record<string, Transfer> }) {
  const active = Object.entries(transfers).filter(([, t]) => !t.done && !t.error);
  return (
    <div
      role="tooltip"
      className="absolute top-full right-0 z-40 mt-1 w-72 rounded-xl border border-(--dolq-border) bg-(--dolq-bg-raised) py-1 shadow-(--dolq-shadow)"
    >
      {active.length === 0 ? (
        <p className="m-0 px-4 py-3 text-[13px] text-(--dolq-text-faint)">Nothing is transferring.</p>
      ) : (
        <>
          {active.slice(0, SHOWN).map(([id, t]) => (
            <div key={id} className="px-4 py-2.5">
              <div className="truncate text-[13px] font-medium text-(--dolq-text)" title={t.filename}>
                {t.filename}
              </div>
              <div className="truncate text-[12px] text-(--dolq-text-dim)">{activeLine(t)}</div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-(--dolq-bg-row-selected)">
                <div
                  className={`h-full rounded-full ${t.paused ? 'bg-(--dolq-text-faint)' : 'bg-(--dolq-brand)'}`}
                  style={{ width: `${transferPercent(t)}%` }}
                />
              </div>
            </div>
          ))}
          {active.length > SHOWN && (
            <p className="m-0 px-4 py-2 text-[12px] text-(--dolq-text-faint)">+{active.length - SHOWN} more</p>
          )}
        </>
      )}
    </div>
  );
}
