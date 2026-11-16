import { useEffect, useState } from 'react';
import type { BackendState, BackendStatus as Status } from '../../../shared/backendState';
import { Icon } from './Icon';

const TITLE: Record<Status, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  failed: 'Not connected',
};

const DOT: Record<Status, string> = {
  connected: 'bg-(--dolq-ok)',
  connecting: 'bg-(--dolq-warn) animate-pulse',
  reconnecting: 'bg-(--dolq-warn) animate-pulse',
  failed: 'bg-(--dolq-danger)',
};

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

type Props = {
  state: BackendState | null;
  onReconnect: () => void;
};

// The link to the backend, for a person: a button in the rail while there is something to tell (a remote backend,
// or a local one that is not running), and a panel with the sentence behind it and the log.
export function BackendStatus({ state, onReconnect }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!state || (state.mode === 'local' && state.status === 'connected')) return null;
  const title = state.mode === 'remote' ? `Remote backend ${state.address}` : 'Local backend';

  async function copyLog() {
    if (!state) return;
    const text = state.log.map((l) => `${time(l.at)}  ${l.text}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // nothing to fall back to; the log stays in the panel
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Backend: ${TITLE[state.status]}`}
        data-tip={`${title}: ${TITLE[state.status]}`}
        onClick={() => setOpen((o) => !o)}
        className="has-tip tip-right relative flex h-10.5 w-10.5 shrink-0 cursor-pointer items-center justify-center rounded-[13px] border-0 bg-transparent p-0 text-(--dolq-text-dim) hover:bg-(--dolq-bg-row-hover) hover:text-(--dolq-text)"
      >
        <Icon name="server" />
        <span
          aria-hidden="true"
          className={`absolute right-1.5 bottom-1.5 h-2.5 w-2.5 rounded-full border-2 border-(--dolq-bg-panel-alt) ${DOT[state.status]}`}
        />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close backend panel"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default border-0 bg-transparent p-0"
          />
          <section
            aria-label="Backend connection"
            className="fixed bottom-3 left-20 z-50 flex max-h-[70vh] w-[440px] max-w-[calc(100vw-96px)] flex-col gap-3 rounded-xl border border-(--dolq-border) bg-(--dolq-bg-raised) p-4 shadow-(--dolq-shadow)"
          >
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[state.status]}`} />
              <h2 className="m-0 text-[14px] font-semibold text-(--dolq-text)">{TITLE[state.status]}</h2>
              <span className="min-w-0 flex-1 truncate text-[12px] text-(--dolq-text-dim)">{title}</span>
            </div>
            <p className="m-0 text-[13px] leading-snug text-(--dolq-text-muted)">{state.detail}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onReconnect}
                className="cursor-pointer rounded-lg border-0 bg-(--dolq-accent) px-3 py-1.5 text-[13px] font-medium text-(--dolq-on-accent) hover:bg-(--dolq-accent-hover)"
              >
                Reconnect
              </button>
              <button
                type="button"
                onClick={copyLog}
                className="cursor-pointer rounded-lg border border-(--dolq-border-strong) bg-transparent px-3 py-1.5 text-[13px] text-(--dolq-text) hover:bg-(--dolq-bg-row-hover)"
              >
                Copy log
              </button>
            </div>
            <ol
              aria-label="Connection log"
              className="m-0 min-h-0 list-none overflow-y-auto rounded-lg bg-(--dolq-bg-panel) p-2.5 font-mono text-[12px] leading-relaxed text-(--dolq-text-muted)"
            >
              {state.log.map((l, i) => (
                <li key={i} className="break-words">
                  <span className="mr-2 text-(--dolq-text-faint)">{time(l.at)}</span>
                  {l.text}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </>
  );
}
