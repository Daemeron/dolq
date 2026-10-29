import { useEffect, useState } from 'react';
import type { HistoryEntry } from '../../../shared/ipc';
import type { Server } from '../types';
import { dayName } from '../utils/dayLabel';
import { nickColor, nickInitial } from '../utils/nickColor';
import { Icon } from './Icon';
import { IrcText } from './IrcText';
import { Segmented, Switch } from './ui';
import { ViewPanel } from './ViewPanel';

type Props = {
  initialScope?: Scope;
  servers: Server[];
  defaultServerId: string;
  defaultChannel: string;
  defaultChannelLabel: string;
  onJump: (serverId: string, channel: string) => void;
  onGetPack: (serverId: string, nick: string, packNumber: number) => void;
  onClose: () => void;
};

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

export type Scope = 'channel' | 'server' | 'everywhere';

const whenLabel = (timestamp: string | number) => {
  const d = new Date(timestamp);
  return `${dayName(d)}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`;
};

export function SearchModal({
  initialScope = 'channel',
  servers,
  defaultServerId,
  defaultChannel,
  defaultChannelLabel,
  onJump,
  onGetPack,
  onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>(initialScope);
  const [packsOnly, setPacksOnly] = useState(false);
  const [results, setResults] = useState<HistoryEntry[] | null>(null);
  const [searched, setSearched] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function runSearch(nextScope: Scope, nextPacksOnly: boolean) {
    const text = query.trim();
    if (!text) return;
    setLoading(true);
    const [serverId, channel] =
      nextScope === 'everywhere'
        ? ['', '']
        : nextScope === 'server'
          ? [defaultServerId, '']
          : [defaultServerId, defaultChannel];
    const limit = nextPacksOnly ? PACKS_ONLY_LIMIT : DEFAULT_LIMIT;
    try {
      const found = await window.irc.search(serverId, channel, text, limit);
      setResults(nextPacksOnly ? found.filter(isPack) : found);
      setSearched(text);
    } catch {
      setResults([]);
      setSearched(text);
    } finally {
      setLoading(false);
    }
  }

  // Changing where to look re-runs a search that is already on screen.
  function changeScope(next: Scope) {
    setScope(next);
    if (results !== null) runSearch(next, packsOnly);
  }

  function changePacksOnly(next: boolean) {
    setPacksOnly(next);
    if (results !== null) runSearch(scope, next);
  }

  const scopeLabel =
    scope === 'everywhere'
      ? 'Everywhere'
      : scope === 'server'
        ? (servers.find((s) => s.id === defaultServerId)?.name ?? 'This server')
        : defaultChannelLabel;

  return (
    <ViewPanel
      title="Search History"
      hideTitle
      top
      width="md"
      onClose={onClose}
      toolbar={
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runSearch(scope, packsOnly);
            }}
            className="flex shrink-0 items-center gap-2.5 border-b border-(--dolq-border) px-4.5 py-3.5"
          >
            <span className="text-(--dolq-text-dim)">
              <Icon name="search" />
            </span>
            <input
              // biome-ignore lint/a11y/noAutofocus: a search palette opens ready to type
              autoFocus
              aria-label="Search messages"
              className="h-7.5 w-full border-0 bg-transparent p-0 text-[15px] text-(--dolq-text) outline-none placeholder:text-(--dolq-text-faint)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for..."
            />
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="cursor-pointer rounded-[5px] border border-b-2 border-(--dolq-border-strong) bg-transparent px-1.5 py-px font-(family-name:--dolq-font-mono) text-[11.5px] text-(--dolq-text-muted) hover:text-(--dolq-text)"
            >
              esc
            </button>
            <button type="submit" disabled={loading} className="sr-only">
              {loading ? 'Searching…' : 'Search'}
            </button>
          </form>
          <div className="flex shrink-0 items-center justify-between gap-3 px-4.5 py-2.5">
            <Segmented
              label="Where to search"
              value={scope}
              onChange={changeScope}
              options={[
                { id: 'channel', label: 'This channel' },
                { id: 'server', label: 'This server' },
                { id: 'everywhere', label: 'Everywhere' },
              ]}
            />
            {/* biome-ignore lint/a11y/noLabelWithoutControl: the label wraps a Switch, which is a checkbox input */}
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-(--dolq-text-muted) select-none">
              <Switch checked={packsOnly} onChange={(e) => changePacksOnly(e.target.checked)} />📦 Packs only
            </label>
          </div>
        </>
      }
    >
      <div className="-mx-6 -mt-2 -mb-5 max-h-110 overflow-y-auto pb-3">
        {results === null ? null : results.length === 0 ? (
          <p className="m-0 mt-6 text-center text-[14px] text-(--dolq-text-faint)">No matches.</p>
        ) : (
          <>
            <div className="px-4 pt-3.5 pb-1.5 text-[12px] font-medium text-(--dolq-text-dim)">
              {scopeLabel} · {results.length} {results.length === 1 ? 'result' : 'results'}
            </div>
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
                  className="flex w-full cursor-pointer gap-3 border-0 bg-transparent px-4.5 py-2 text-left hover:bg-(--dolq-bg-row-hover)"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white"
                    style={{ background: nick ? nickColor(nick) : 'var(--dolq-text-faint)' }}
                  >
                    {pack ? '📦' : nick ? nickInitial(nick) : '·'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      {nick && (
                        <span className="text-[14px] font-semibold" style={{ color: nickColor(nick) }}>
                          {nick}
                        </span>
                      )}
                      <span className="text-[12px] text-(--dolq-text-dim)">
                        {serverName} / {channelLabel} · {whenLabel(entry.timestamp)}
                      </span>
                    </span>
                    <span
                      className={`block text-[14px] break-words ${pack ? 'font-(family-name:--dolq-font-mono) text-(--dolq-text-muted)' : 'text-(--dolq-text)'}`}
                    >
                      <IrcText text={text} mark={pack ? undefined : searched} />
                    </span>
                  </span>
                </button>
              );
            })}
          </>
        )}
      </div>
    </ViewPanel>
  );
}
