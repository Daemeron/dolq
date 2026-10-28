import { useEffect } from 'react';
import { Button, Card, Setting } from './ui';
import { ViewPanel } from './ViewPanel';

type Props = {
  nick: string;
  filename: string;
  size: number;
  // False when the offer carries nothing to recognise the sender by
  trustable: boolean;
  onAccept: () => void;
  onAcceptSession: () => void;
  onAcceptAlways: () => void;
  onDecline: () => void;
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

export function XDCCOfferModal({
  nick,
  filename,
  size,
  trustable,
  onAccept,
  onAcceptSession,
  onAcceptAlways,
  onDecline,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onDecline();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDecline]);

  return (
    <ViewPanel
      title="File offer"
      description="Incoming offers need your approval before anything is downloaded. Only accept from someone, or a bot, you trust."
      width="sm"
      onClose={onDecline}
      footer={
        <>
          <Button onClick={onDecline}>Decline</Button>
          <Button variant="primary" onClick={onAccept}>
            Accept
          </Button>
        </>
      }
    >
      <Card className="border-(--dolq-accent) bg-(--dolq-accent-soft)">
        <Setting
          title={`${nick} offers a file`}
          description={
            <span className="font-(family-name:--dolq-font-mono) break-all">
              {filename} · {formatBytes(size)} · DCC SEND
            </span>
          }
        />
      </Card>
      {trustable && (
        <div className="flex flex-col items-start gap-1">
          <button
            type="button"
            onClick={onAcceptSession}
            className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-(--dolq-text-dim) hover:text-(--dolq-text) hover:underline"
          >
            Accept and trust {nick} until this server disconnects
          </button>
          <button
            type="button"
            onClick={onAcceptAlways}
            className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-(--dolq-text-dim) hover:text-(--dolq-text) hover:underline"
          >
            Accept and always trust {nick}
          </button>
        </div>
      )}
    </ViewPanel>
  );
}
