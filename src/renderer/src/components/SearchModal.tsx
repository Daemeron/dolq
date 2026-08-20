import { useState } from 'react';
import type { HistoryEntry } from '../../../shared/ipc';
import type { Server } from '../types';
import { IrcText } from './IrcText';

type Props = {
  servers: Server[];
  defaultServerId: string;
  defaultChannel: string; // backend channel key for "this channel" scope - see App.tsx's backendChannelFor
  defaultChannelLabel: string; // display name for that scope, e.g. "#general" or "Log"
  onJump: (serverId: string, channel: string) => void;
  // Requests a pack a search hit turned up - see App.tsx's handleGetPackFrom.
  // Unlike MessageArea's onGetPack, this needs serverId too: a search result
  // isn't necessarily on whatever server is currently selected.
  onGetPack: (serverId: string, nick: string, packNumber: number) => void;
  onClose: () => void;
};

const inputClass =
  'w-full bg-[var(--dolq-bg-input)] border-0 rounded text-[var(--dolq-text)] text-[14px] px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#c792ea] placeholder:text-[var(--dolq-text-faint)]';

// "Packs only" filters client-side rather than in the query itself - the
// backend's search is a plain payload LIKE match (see
// history.Store.Search), with no notion of an event's type to filter on.
// Fetching a wider limit when this is on compensates for that: filtering
// after a 100-row fetch could easily come back empty even when more packs
// exist further back.
const PACKS_ONLY_LIMIT = 300;
const DEFAULT_LIMIT = 100;

function isPack(entry: HistoryEntry): boolean {
  return !entry.isRaw && entry.event?.type === 'XDCCPACK';
}

// A search result's payload can be a raw line or any parsed event - most
// real hits will be chat text (PRIVMSG/ACTION/NOTICE) or a raw line, so
// that's what gets a proper nick+text preview; anything else (a JOIN a
// search term happened to match inside, say) just falls back to its raw
// JSON rather than needing a case for every event type search barely ever
// actually matches. XDCCPACK gets its own case, matching MessageArea's
// 📦 row - handled by the caller instead, since it also needs a different
// click action (request the pack, not just jump to it).
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
  servers, defaultServerId, defaultChannel, defaultChannelLabel, onJump, onGetPack, onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const [global, setGlobal] = useState(false);
  const [packsOnly, setPacksOnly] = useState(false);
  const [results, setResults] = useState<HistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

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
        className="bg-[var(--dolq-bg-panel)] rounded-lg p-6 w-140 max-h-[80vh] flex flex-col shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[var(--dolq-text)] text-[18px] font-bold mb-4 shrink-0">Search History</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 shrink-0">
          <input
            className={inputClass}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for..."
            autoFocus
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-[13px] text-[var(--dolq-text)] cursor-pointer select-none">
                <input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} className="accent-[#c792ea]" />
                Search everywhere, not just {defaultChannelLabel}
              </label>
              <label className="flex items-center gap-2 text-[13px] text-[var(--dolq-text)] cursor-pointer select-none">
                <input type="checkbox" checked={packsOnly} onChange={(e) => setPacksOnly(e.target.checked)} className="accent-[#c792ea]" />
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
            <p className="text-[var(--dolq-text-faint)] text-[14px] text-center mt-4">No matches.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {results.map((entry) => {
                const { nick, text } = preview(entry);
                const serverName = servers.find((s) => s.id === entry.serverId)?.name ?? entry.serverId;
                const channelLabel = entry.channel === '__log__' ? 'Log' : entry.channel;
                const pack = isPack(entry) && entry.event?.type === 'XDCCPACK' ? entry.event : null;
                return (
                  <button
                    key={entry.id}
                    onClick={() => (pack ? onGetPack(entry.serverId, pack.nick, pack.number) : onJump(entry.serverId, entry.channel))}
                    title={pack ? 'Click to request this pack' : undefined}
                    className="flex flex-col items-start gap-0.5 w-full px-3 py-2 rounded border-0 bg-[var(--dolq-bg-raised)] text-left cursor-pointer hover:bg-[var(--dolq-bg-hover)]"
                  >
                    <span className="text-[11px] text-[var(--dolq-text-faint)]">
                      {serverName} / {channelLabel} · {new Date(entry.timestamp).toLocaleString()}
                    </span>
                    <span className={`text-[14px] truncate w-full ${pack ? 'font-mono text-[var(--dolq-text-muted)]' : 'text-[var(--dolq-text)]'}`}>
                      {pack ? (
                        `📦 ${text}`
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
            onClick={onClose}
            className="px-4 py-2 rounded text-[var(--dolq-text-muted)] text-[14px] font-medium bg-transparent border-0 cursor-pointer hover:text-[var(--dolq-text)]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
