import { useEffect } from 'react';
import type { IrcEvent } from '../../../shared/ipc';
import { dayName } from '../utils/dayLabel';
import { nickColor, nickInitial } from '../utils/nickColor';
import { IrcText } from './IrcText';
import { Button, Card } from './ui';
import { ViewPanel } from './ViewPanel';

type WhoisInfo = Extract<IrcEvent, { type: 'whois' }>;

type Props = {
  nick: string;
  result: WhoisInfo | null;
  onClose: () => void;
  onMessage?: () => void;
  onIgnore?: () => void;
};

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

export function formatIdle(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${plural(h, 'hour')} ${plural(m, 'minute')}` : plural(h, 'hour');
  if (m > 0) return plural(m, 'minute');
  return plural(seconds, 'second');
}

function formatSignon(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${dayName(d)}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

function Row({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 px-4 py-3.5">
      <span className="shrink-0 text-[13px] text-(--dolq-text-dim)">{label}</span>
      <span className="min-w-0 truncate text-[14px] text-(--dolq-text)" title={title}>
        {children}
      </span>
    </div>
  );
}

export function WhoisModal({ nick, result, onClose, onMessage, onIgnore }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const color = nickColor(nick);
  const known = result && !result.noSuchNick;

  return (
    <ViewPanel
      title={nick}
      description={known && result.user && result.host ? `${result.user}@${result.host}` : undefined}
      width="sm"
      onClose={onClose}
      leading={
        <span
          aria-hidden="true"
          className="flex size-13 shrink-0 items-center justify-center rounded-full text-[20px] font-semibold text-white"
          style={{ background: color }}
        >
          {nickInitial(nick)}
        </span>
      }
      footer={
        <div className="flex w-full items-center justify-between">
          {onIgnore ? (
            <Button variant="danger" onClick={onIgnore}>
              Ignore
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            {onMessage && (
              <Button variant="primary" onClick={onMessage}>
                Message
              </Button>
            )}
          </div>
        </div>
      }
    >
      {!result ? (
        <p className="m-0 text-[14px] text-(--dolq-text-dim)">Looking up...</p>
      ) : result.noSuchNick ? (
        <p className="m-0 text-[14px] text-(--dolq-text-dim)">No such nick - they may have quit or changed nick.</p>
      ) : (
        <Card>
          {result.realname && (
            <Row label="Real name">
              <IrcText text={result.realname} />
            </Row>
          )}
          {result.account && <Row label="Account">{result.account}</Row>}
          {result.server && (
            <Row label="Server" title={result.serverInfo}>
              {result.server}
            </Row>
          )}
          {result.idleSeconds !== undefined && <Row label="Idle">{formatIdle(result.idleSeconds)}</Row>}
          {result.signonTime !== undefined && <Row label="Signed on">{formatSignon(result.signonTime)}</Row>}
          {result.channels && result.channels.length > 0 && (
            <Row label="Channels">
              <span className="font-(family-name:--dolq-font-mono) text-[13px]">{result.channels.join('  ')}</span>
            </Row>
          )}
          {result.away && (
            <Row label="Away">
              <IrcText text={result.away} />
            </Row>
          )}
        </Card>
      )}
    </ViewPanel>
  );
}
