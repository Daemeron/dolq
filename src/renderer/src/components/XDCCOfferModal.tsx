import { useEffect, useState } from 'react';
import { ContextMenuItem } from './ContextMenu';
import { Icon } from './Icon';
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

type Mode = 'once' | 'session' | 'always';

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
  const [menuOpen, setMenuOpen] = useState(false);
  // What the Accept button does: the menu only picks this, the button itself accepts.
  const [mode, setMode] = useState<Mode>('once');
  const accept = { once: onAccept, session: onAcceptSession, always: onAcceptAlways }[mode];
  const label = { once: 'Accept', session: 'Accept for session', always: 'Always accept' }[mode];
  const choose = (next: Mode) => {
    setMode(next);
    setMenuOpen(false);
  };

  // Escape closes the trust menu first, and only a second press declines the offer.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (menuOpen) setMenuOpen(false);
      else onDecline();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDecline, menuOpen]);

  return (
    <ViewPanel
      title="File offer"
      description="Incoming offers need your approval before anything is downloaded. Only accept from someone, or a bot, you trust."
      width="sm"
      onClose={onDecline}
      footer={
        <>
          <Button onClick={onDecline}>Decline</Button>
          {/* Accept, with the trust options attached to its right edge. */}
          <div className="relative flex">
            <Button variant="primary" className={trustable ? 'rounded-r-none' : ''} onClick={accept}>
              {label}
            </Button>
            {trustable && (
              <Button
                variant="primary"
                aria-label="Choose how to accept"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="rounded-l-none border-l-(--dolq-on-brand)/30 px-2!"
                onClick={() => setMenuOpen((open) => !open)}
              >
                <Icon name="chevronDown" size={16} />
              </Button>
            )}
            {menuOpen && (
              <>
                <div aria-hidden="true" className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div
                  role="menu"
                  className="absolute right-0 bottom-full z-20 mb-2 w-max rounded-lg bg-(--dolq-bg-input) py-1.5 shadow-(--dolq-shadow)"
                >
                  <ContextMenuItem checked={mode === 'once'} onClick={() => choose('once')}>
                    Accept this file only
                  </ContextMenuItem>
                  <ContextMenuItem checked={mode === 'session'} onClick={() => choose('session')}>
                    Accept from {nick} for this session
                  </ContextMenuItem>
                  <ContextMenuItem checked={mode === 'always'} onClick={() => choose('always')}>
                    Always accept from {nick}
                  </ContextMenuItem>
                </div>
              </>
            )}
          </div>
        </>
      }
    >
      <Card className="border-(--dolq-brand) bg-(--dolq-brand-soft)">
        <Setting
          title={`${nick} offers a file`}
          description={
            <span className="font-(family-name:--dolq-font-mono) break-all">
              {filename} · {formatBytes(size)} · DCC SEND
            </span>
          }
        />
      </Card>
    </ViewPanel>
  );
}
