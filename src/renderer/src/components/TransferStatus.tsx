import { formatBytes } from '../utils/bytes';
import { activeLine, transferPercent } from '../utils/transferLine';
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
  /** A file going out to `nick`, not one coming in. */
  sending?: boolean;
};

/** The folder part of a file path, whichever separator the platform uses. */
const folderOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '') || path;

type Props = {
  transfers: Record<string, Transfer>;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
  /** Forgets every transfer that has ended. */
  onClearFinished?: () => void;
  onShowInFolder?: (path: string) => void;
  onClose: () => void;
  /** Shown above the list, for queuing packs from a packlist. */
  packQueue?: React.ReactNode;
};

export function TransferStatus({
  transfers,
  onPause,
  onResume,
  onCancel,
  onDismiss,
  onClearFinished,
  onShowInFolder,
  onClose,
  packQueue,
}: Props) {
  const entries = Object.entries(transfers);

  return (
    <ViewPanel
      title="Transfers"
      description="Incoming offers need your approval before anything is downloaded."
      onClose={onClose}
    >
      {packQueue}
      {onClearFinished && entries.some(([, t]) => t.done || t.error) && (
        <div className="mb-2 flex justify-end">
          <Button variant="ghost" small onClick={onClearFinished}>
            Clear finished
          </Button>
        </div>
      )}
      {entries.length === 0 ? (
        <p className="m-0 py-6 text-center text-[14px] text-(--dolq-text-faint)">
          No transfers yet. Downloads and file offers show up here.
        </p>
      ) : (
        <Card>
          {entries.map(([id, t]) => {
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
                      `${t.sending ? 'Sent' : 'Completed'} · ${formatBytes(t.total)}`
                    ) : (
                      activeLine(t)
                    )}
                  </div>
                  {t.path && !t.sending && (
                    <div className="truncate text-[12px] text-(--dolq-text-faint)" title={t.path}>
                      {t.done ? 'Saved in' : 'Saving to'} {folderOf(t.path)}
                    </div>
                  )}
                  {!finished && (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-(--dolq-bg-row-selected)">
                      <div
                        className={`h-full rounded-full transition-[width] ${t.paused ? 'bg-(--dolq-text-faint)' : 'bg-(--dolq-brand)'}`}
                        style={{ width: `${transferPercent(t)}%` }}
                      />
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {!finished && !t.sending && (
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
