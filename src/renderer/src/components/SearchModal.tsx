import { useEffect, useState } from 'react';
import type { HistoryEntry } from '../../../shared/ipc';
import { useModalA11y } from '../hooks/useModalA11y';
import type { Server } from '../types';
import { IrcText } from './IrcText';

type Props = {
  servers: Server[];
  defaultServerId: string;
  defaultChannel: string;
  defaultChannelLabel: string;
  onJump: (serverId: string, channel: string) => void;
  onGetPack: (serverId: string, nick: string, packNumber: number) => void;
  onClose: () => void;
};

const inputClass =
  'w-full bg-[var(--dolq-bg-input)] border-0 rounded text-[var(--dolq-text)] text-[14px] px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#c792ea] placeholder:text-[var(--dolq-text-faint)]';

const PACKS_ONLY_LIMIT = 300;
const DEFAULT_LIMIT = 100;

function isPack(entry: HistoryEntry): boolean {
  return !entry.isRaw && entry.event?.type === 'XDCCPACK';
}

function preview(entry: HistoryEntry): { nick: string; text: string } {
  if (entry.isRaw) return { nick: '', text: entry.line ?? '' };
  const e = entry.event;
  if (e?.type === 'PRIVMSG' || e?.type === 'ACTION' || e?.type === 'NOTICE') {
    return { nick: e.nick, text: e.text };
  }
  if (e?.type === 'XDCCPACK') {
    return { nick: e.nick, text: `#${e.number} · ${e.gets}x sent · ${e.size} · ${e.filename}` };
  }
  return { nick: '', text: e ? JSON.stringify(e) : '' };
}

export function SearchModal({
  servers,
  defaultServerId,
  defaultChannel,
  defaultChannelLabel,
  onJump,
  onGetPack,
  onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const [global, setGlobal] = useState(false);
  const [packsOnly, setPacksOnly] = useState(false);
  const [results, setResults] = useState<HistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const dialogRef = useModalA11y<HTMLDivElement>();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    const [serverId, channel] = global ? ['', ''] : [defaultServerId, defaultChannel];
    const limit = packsOnly ? PACKS_ONLY_LIMIT : DEFAULT_LIMIT;
    const found = await window.irc.search(serverId, channel, query.trim(), limit);
    setLoading(false);
    setResults(packsOnly ? found.filter(isPack) : found);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="search-modal-title"
        tabIndex={-1}
        className="bg-(--dolq-bg-panel) rounded-lg p-6 w-140 max-h-[80vh] flex flex-col shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="search-modal-title" className="text-(--dolq-text) text-[18px] font-bold mb-4 shrink-0">
          Search History
        </h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 shrink-0">
          <input
            className={inputClass}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for..."
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-[13px] text-(--dolq-text) cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={global}
                  onChange={(e) => setGlobal(e.target.checked)}
                  className="accent-[#c792ea]"
                />
                Search everywhere, not just {defaultChannelLabel}
              </label>
              <label className="flex items-center gap-2 text-[13px] text-(--dolq-text) cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={packsOnly}
                  onChange={(e) => setPacksOnly(e.target.checked)}
                  className="accent-[#c792ea]"
                />
                📦 Packs only
              </label>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded bg-[#c792ea] text-white text-shadow-sm text-[14px] font-semibold border-0 cursor-pointer hover:bg-[#a579c2] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
        </form>

        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin mt-4 -mx-1 px-1">
          {results === null ? null : results.length === 0 ? (
            <p className="text-(--dolq-text-faint) text-[14px] text-center mt-4">No matches.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {results.map((entry) => {
                const { nick, text } = preview(entry);
                const serverName = servers.find((s) => s.id === entry.serverId)?.name ?? entry.serverId;
                const channelLabel = entry.channel === '__log__' ? 'Log' : entry.channel;
                const pack = isPack(entry) && entry.event?.type === 'XDCCPACK' ? entry.event : null;
                return (
                  <button
                    type="button"
                    key={entry.id}
                    onClick={() =>
                      pack ? onGetPack(entry.serverId, pack.nick, pack.number) : onJump(entry.serverId, entry.channel)
                    }
                    title={pack ? 'Click to request this pack' : undefined}
                    className="flex flex-col items-start gap-0.5 w-full px-3 py-2 rounded border-0 bg-(--dolq-bg-raised) text-left cursor-pointer hover:bg-(--dolq-bg-hover)"
                  >
                    <span className="text-[11px] text-(--dolq-text-faint)">
                      {serverName} / {channelLabel} · {new Date(entry.timestamp).toLocaleString()}
                    </span>
                    <span
                      className={`text-[14px] truncate w-full ${pack ? 'font-mono text-(--dolq-text-muted)' : 'text-(--dolq-text)'}`}
                    >
                      {pack ? (
                        <>
                          📦 <IrcText text={text} />
                        </>
                      ) : (
                        <>
                          {nick && <span className="font-semibold mr-1.5">{nick}</span>}
                          <IrcText text={text} />
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end mt-4 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded text-(--dolq-text-muted) text-[14px] font-medium bg-transparent border-0 cursor-pointer hover:text-(--dolq-text)"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
