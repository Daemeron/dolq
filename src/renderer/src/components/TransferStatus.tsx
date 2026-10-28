import { IconButton } from './Icon';
import { Button, Card } from './ui';
import { ViewPanel } from './ViewPanel';

export type Transfer = {
  nick: string;
  filename: string;
  received: number;
  total: number;
  done?: boolean;
  error?: string;
  paused?: boolean;
  speedBps?: number;
  path?: string;
};

type Props = {
  transfers: Record<string, Transfer>;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
  onShowInFolder?: (path: string) => void;
  onClose: () => void;
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

export function TransferStatus({ transfers, onPause, onResume, onCancel, onDismiss, onShowInFolder, onClose }: Props) {
  const entries = Object.entries(transfers);

  return (
    <ViewPanel
      title="Transfers"
      description="Incoming offers need your approval before anything is downloaded."
      onClose={onClose}
    >
      {entries.length === 0 ? (
        <p className="m-0 py-6 text-center text-[14px] text-(--dolq-text-faint)">
          No transfers yet. Downloads and file offers show up here.
        </p>
      ) : (
        <Card>
          {entries.map(([id, t]) => {
            const pct = t.total > 0 ? Math.min(100, Math.round((t.received / t.total) * 100)) : 0;
            const finished = t.done || !!t.error;
            return (
              <div key={id} className="flex items-center gap-4 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium text-(--dolq-text)" title={t.filename}>
                    {t.filename}
                  </div>
                  <div className="text-[13px] text-(--dolq-text-dim)">
                    {t.error ? (
                      <span className="text-(--dolq-danger)">Failed: {t.error}</span>
                    ) : t.done ? (
                      `Completed · ${formatBytes(t.total)}`
                    ) : t.paused ? (
                      `${t.nick} · ${pct}% of ${formatBytes(t.total)} · paused`
                    ) : (
                      `${t.nick} · ${pct}% of ${formatBytes(t.total)}${t.speedBps ? ` · ${formatBytes(t.speedBps)}/s` : ''}`
                    )}
                  </div>
                  {!finished && (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-(--dolq-bg-row-selected)">
                      <div
                        className={`h-full rounded-full transition-[width] ${t.paused ? 'bg-(--dolq-text-faint)' : 'bg-(--dolq-accent)'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {!finished && (
                    <IconButton
                      icon={t.paused ? 'play' : 'pause'}
                      label={t.paused ? 'Resume' : 'Pause'}
                      onClick={() => (t.paused ? onResume(id) : onPause(id))}
                    />
                  )}
                  {t.done && t.path && onShowInFolder && (
                    <Button small variant="ghost" onClick={() => onShowInFolder(t.path as string)}>
                      Show in folder
                    </Button>
                  )}
                  <IconButton
                    icon="close"
                    label={finished ? 'Dismiss' : 'Cancel'}
                    onClick={() => (finished ? onDismiss(id) : onCancel(id))}
                  />
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </ViewPanel>
  );
}
