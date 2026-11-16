import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useContextMenu } from '../hooks/useContextMenu';
import type { Message } from '../types';
import { dayLabel } from '../utils/dayLabel';
import { continuesGroup, groupAround } from '../utils/groupMessages';
import { type LogTone, logLineParts } from '../utils/logLine';
import { hiddenByFold, membershipRuns } from '../utils/membershipGroups';
import { mentionsAny } from '../utils/mentions';
import { nickColor, nickInitial } from '../utils/nickColor';
import { plainText } from '../utils/plainText';
import { remeasureRows } from '../utils/remeasureRows';
import { estimateRowSize } from '../utils/rowSize';
import { startsNewSession } from '../utils/session';
import { Icon, type IconName } from './Icon';
import { IrcText } from './IrcText';
import { MembershipSummary } from './MembershipSummary';
import { type NickActions, NickMenu, queryOnClick } from './NickMenu';

type Props = {
  messages: Message[];
  isLog: boolean;
  channelId: string;
  onLoadOlder?: () => void;
  timestampFormat: '12h' | '24h';
  density: 'cozy' | 'compact';
  onGetPack?: (nick: string, packNumber: number) => void;
  // Lines from others that name this nick get an accent background.
  selfNick?: string;
  highlightWords?: string[];
  /** What clicking or right-clicking a nick does; without it nicks are plain text. */
  nickActions?: NickActions;
};

function formatTime(d: Date, timestampFormat: '12h' | '24h'): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: timestampFormat === '12h' });
}

const AT_BOTTOM_THRESHOLD = 40;
// Scrolled up further than this from the newest line, the view offers a way back down.
const JUMP_DISTANCE = 300;
const LOAD_OLDER_THRESHOLD = 100;
const TONE_COLOR: Record<LogTone, string> = {
  welcome: 'text-(--dolq-ok)',
  info: 'text-(--dolq-nick-7)',
  motd: 'text-(--dolq-nick-6)',
  banner: 'text-(--dolq-accent-text)',
  notice: 'text-(--dolq-nick-2)',
  cap: 'text-(--dolq-download)',
  mode: 'text-(--dolq-warn)',
  whois: 'text-(--dolq-nick-1)',
  away: 'text-(--dolq-nick-4)',
  plain: 'text-(--dolq-text)',
};

// A server line with its source dimmed and its command and text coloured by what kind of line it is.
function LogLine({ text, important }: { text: string; important?: boolean }) {
  const { prefix, command, params, tone } = logLineParts(text);
  const color = important ? 'text-(--dolq-danger) font-semibold' : TONE_COLOR[tone];
  return (
    <>
      {prefix && <span className="text-(--dolq-text-faint)">{prefix} </span>}
      <span className={`${color} font-semibold`}>{command}</span>{' '}
      <span className={color}>
        <IrcText text={params} />
      </span>
    </>
  );
}

// Pages a view may ask for in a row without a scroll, so lines hidden at draw time cannot make it crawl all history.
// Appear at the right end of a message while the pointer is over it: one copies the line, and for a line that is part
// of a run from the same person, another copies the whole run, a line each. Formatting codes are left out.
function CopyMessage({ text, group }: { text: string; group: string[] }) {
  const [copied, setCopied] = useState<'line' | 'all' | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = (kind: 'line' | 'all', value: string) =>
    navigator.clipboard
      .writeText(value)
      .then(() => setCopied(kind))
      .catch(() => {});
  const button = (kind: 'line' | 'all', label: string, icon: IconName, value: string) => {
    const shown = copied === kind ? 'Copied' : label;
    return (
      <button
        type="button"
        aria-label={shown}
        data-tip={shown}
        onClick={() => copy(kind, value)}
        className="has-tip flex size-6.5 cursor-pointer items-center justify-center rounded-md border border-(--dolq-border) bg-(--dolq-bg-raised) text-(--dolq-text-dim) shadow-sm hover:text-(--dolq-text)"
      >
        <Icon name={copied === kind ? 'check' : icon} size={14} />
      </button>
    );
  };
  return (
    <div className="absolute top-1 right-7 flex gap-1 opacity-0 focus-within:opacity-100 group-hover/row:opacity-100">
      {button('line', 'Copy message', 'copy', plainText(text))}
      {group.length > 1 && button('all', `Copy all ${group.length} lines`, 'lines', group.map(plainText).join('\n'))}
    </div>
  );
}

const MAX_AUTO_LOADS = 20;

export function MessageArea({
  messages,
  isLog,
  channelId,
  onLoadOlder,
  timestampFormat,
  density,
  onGetPack,
  selfNick,
  highlightWords,
  nickActions,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevChannelId = useRef(channelId);
  const scrollTop = useRef<Map<string, number>>(new Map());
  const isAtBottom = useRef<Map<string, boolean>>(new Map());
  const autoLoads = useRef(0);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const nickMenu = useContextMenu<string>();

  // A nick, or the avatar next to it: a click opens a conversation with that person and a right click opens their
  // menu, the same as in the member list.
  const asNick = (
    nick: string,
    children: React.ReactNode,
    className: string,
    style?: React.CSSProperties,
    decorative = false,
  ) => {
    if (!nickActions) {
      return (
        <span className={className} style={style} aria-hidden={decorative || undefined}>
          {children}
        </span>
      );
    }
    const open = queryOnClick(nickActions, nick);
    return (
      <button
        type="button"
        tabIndex={decorative ? -1 : undefined}
        aria-hidden={decorative || undefined}
        onClick={open}
        onContextMenu={(e) => nickMenu.open(nick, e)}
        title={open ? `Message ${nick}` : undefined}
        className={`${className} border-0 bg-transparent p-0 ${open ? 'cursor-pointer' : 'cursor-default'} ${open && !decorative ? 'hover:underline' : ''}`}
        style={style}
      >
        {children}
      </button>
    );
  };
  const { runs, followers } = useMemo(() => membershipRuns(messages), [messages]);
  // Runs the user has opened, by `channel:first message id`.
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const isOpen = (firstId: number) => opened.has(`${channelId}:${firstId}`);
  const toggle = (firstId: number) =>
    setOpened((prev) => {
      const next = new Set(prev);
      const key = `${channelId}:${firstId}`;
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const switchedChannel = prevChannelId.current !== channelId;
  const compact = density === 'compact';

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => containerRef.current,
    // A folded-away line measures 0, so estimating it taller would shift the scroll as each one comes into view.
    estimateSize: (index) => {
      const { id } = messages[index];
      return estimateRowSize({
        isLog,
        compact,
        hidden: hiddenByFold(followers, id, isOpen),
        run: runs.has(id) ? (isOpen(id) ? 'open' : 'closed') : null,
      });
    },
    getItemKey: (index) => messages[index].id,
    overscan: 8,
    // The virtualizer reports changes from layout effects, where React refuses a synchronous flush.
    useFlushSync: false,
    anchorTo: 'end',
    followOnAppend: switchedChannel ? false : 'smooth',
    scrollEndThreshold: AT_BOTTOM_THRESHOLD,
  });

  // A row's height is read when it is drawn and when its own size changes. A line that turns into the head of a folded
  // run, or a run that grows, can end up drawn at a stale height, with the rows after it painted over its text. So the
  // drawn rows are measured again whenever the lines or the folds change, and once the web fonts are in.
  // The virtualizer's own measure call answers from its cache once a row has a size, so the real height is set directly.
  const remeasure = useCallback(
    () =>
      remeasureRows(containerRef.current, (row) =>
        rowVirtualizer.resizeItem(
          Number((row as HTMLElement).dataset.index),
          Math.round(row.getBoundingClientRect().height),
        ),
      ),
    [rowVirtualizer],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new list of lines or a fold toggled is the trigger
  useLayoutEffect(remeasure, [remeasure, messages, opened]);
  useEffect(() => {
    void document.fonts?.ready.then(remeasure);
  }, [remeasure]);

  useLayoutEffect(() => {
    if (switchedChannel) {
      const el = containerRef.current;
      if (el) {
        const wasAtBottom = isAtBottom.current.get(channelId) !== false;
        el.scrollTop = wasAtBottom ? el.scrollHeight : (scrollTop.current.get(channelId) ?? el.scrollHeight);
      }
    }
    prevChannelId.current = channelId;
  }, [channelId, switchedChannel]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new channel starts its own count
  useLayoutEffect(() => {
    autoLoads.current = 0;
  }, [channelId]);

  // Older pages load on scroll, and a view whose lines do not fill it yet has
  // nothing to scroll, so it asks for the next page itself, up to
  // MAX_AUTO_LOADS times until the next scroll. onLoadOlder does nothing while
  // a page is loading or once history runs out, and a failed fetch changes no
  // messages, so this does not run again on its own.
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages changes whenever a page lands
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !onLoadOlder || el.scrollHeight > el.clientHeight || autoLoads.current >= MAX_AUTO_LOADS) return;
    autoLoads.current++;
    onLoadOlder();
  }, [messages, onLoadOlder]);

  function updateAwayFromBottom() {
    const el = containerRef.current;
    if (el) setAwayFromBottom(el.scrollHeight - el.scrollTop - el.clientHeight > JUMP_DISTANCE);
  }

  // Lines arriving while the view is scrolled up add to the distance without a scroll, and so does a channel switch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new list of lines or channel is the trigger
  useLayoutEffect(updateAwayFromBottom, [messages, channelId]);

  function jumpToLatest() {
    if (messages.length > 0) rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end', behavior: 'smooth' });
  }

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    updateAwayFromBottom();
    autoLoads.current = 0;
    scrollTop.current.set(channelId, el.scrollTop);
    isAtBottom.current.set(channelId, el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_THRESHOLD);
    if (onLoadOlder && el.scrollTop < LOAD_OLDER_THRESHOLD) onLoadOlder();
  }

  // A wheel up at the top moves nothing, so no scroll comes to start a new
  // count; a view that does not fill would stay stuck once it stopped asking.
  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    const el = containerRef.current;
    if (!el || !onLoadOlder || e.deltaY >= 0 || el.scrollTop > 0) return;
    autoLoads.current = 0;
    onLoadOlder();
  }

  const virtualRows = rowVirtualizer.getVirtualItems();

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a right click anywhere else closes a nick's menu
    <div className="relative flex min-h-0 flex-1 flex-col" onContextMenu={nickMenu.dismissIfUnhandled}>
      <div ref={containerRef} onScroll={handleScroll} onWheel={handleWheel} className="flex-1 overflow-y-auto py-2">
        {messages.length === 0 ? (
          <p
            className={
              isLog ? 'text-(--dolq-text-faint) text-[14px]' : 'text-(--dolq-text-faint) text-[14px] text-center mt-8'
            }
          >
            {isLog ? 'No traffic yet.' : 'No messages yet.'}
          </p>
        ) : (
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            {virtualRows.map((virtualRow) => {
              const m = messages[virtualRow.index];
              const requestPack = () => {
                if (onGetPack && m.xdccPackNumber != null) onGetPack(m.nick, m.xdccPackNumber);
              };
              const day = isLog ? null : dayLabel(messages[virtualRow.index - 1], m);
              const newSession = isLog && startsNewSession(messages[virtualRow.index - 1]);
              const run = runs.get(m.id);
              // Folded away: the first line of a closed run shows the summary alone, the rest show nothing.
              const folded = run ? !isOpen(m.id) : hiddenByFold(followers, m.id, isOpen);
              const mention =
                !!selfNick &&
                !isLog &&
                !m.system &&
                m.nick !== selfNick &&
                mentionsAny(m.text, selfNick, highlightWords ?? []);
              return (
                <div
                  key={virtualRow.key}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  className={`group/row ${mention ? 'bg-(--dolq-brand-soft)' : ''}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {day && (
                    <div className="flex items-center gap-3 mx-7 mt-4 mb-2 text-[12px] font-medium text-(--dolq-text-dim)">
                      <span className="h-px flex-1 bg-(--dolq-border)" />
                      {day}
                      <span className="h-px flex-1 bg-(--dolq-border)" />
                    </div>
                  )}
                  {newSession && (
                    <div className="mx-7 mt-8 mb-3 flex items-center gap-3">
                      <span className="h-px flex-1 bg-(--dolq-border-strong)" />
                      <span className="rounded-full bg-(--dolq-brand-soft) px-3 py-0.5 text-[11px] font-semibold tracking-wider text-(--dolq-brand-text) uppercase">
                        New session
                      </span>
                      <span className="h-px flex-1 bg-(--dolq-border-strong)" />
                    </div>
                  )}
                  {run && (
                    <MembershipSummary
                      run={run}
                      open={isOpen(m.id)}
                      onToggle={() => toggle(m.id)}
                      formatTime={(d) => formatTime(d, timestampFormat)}
                    />
                  )}
                  {folded ? null : isLog ? (
                    <div className="font-mono text-[12px] leading-5 whitespace-pre-wrap break-all px-7 text-(--dolq-text)">
                      <span className="text-(--dolq-text-faint) mr-3">{formatTime(m.timestamp, timestampFormat)}</span>
                      <LogLine text={m.text} important={m.important} />
                    </div>
                  ) : m.system ? (
                    <div className={`group flex items-baseline gap-3 px-7 ${compact ? 'py-0' : 'py-1'}`}>
                      <span className="text-[11px] text-(--dolq-text-faint) shrink-0 w-9 flex justify-end whitespace-nowrap opacity-0 group-hover:opacity-100">
                        {formatTime(m.timestamp, timestampFormat)}
                      </span>
                      <span className="text-(--dolq-text-faint) text-[13px] italic">
                        <IrcText text={m.text} />
                      </span>
                    </div>
                  ) : m.notice ? (
                    <div className={`flex items-baseline gap-3 px-7 ${compact ? 'py-0' : 'py-0.5'}`}>
                      <span className="text-[11px] text-(--dolq-text-faint) shrink-0 w-9 flex justify-end whitespace-nowrap">
                        {formatTime(m.timestamp, timestampFormat)}
                      </span>
                      <span className="text-[13px] italic text-(--dolq-text-dim)">
                        {asNick(m.nick, `-${m.nick}-`, '', { color: nickColor(m.nick) })} <IrcText text={m.text} />
                      </span>
                    </div>
                  ) : m.xdccPack ? (
                    // biome-ignore lint/a11y/noStaticElementInteractions: role and tabIndex are set when a pack handler exists
                    <div
                      className={`flex items-baseline gap-3 px-7 ${compact ? 'py-0' : 'py-0.5'} ${
                        onGetPack && m.xdccPackNumber != null ? 'cursor-pointer hover:bg-(--dolq-bg-row-hover)' : ''
                      }`}
                      role={onGetPack ? 'button' : undefined}
                      tabIndex={onGetPack ? 0 : undefined}
                      onClick={requestPack}
                      onKeyDown={(e) => e.key === 'Enter' && requestPack()}
                      title={onGetPack ? 'Click to request this pack' : undefined}
                    >
                      <span className="text-[11px] text-(--dolq-text-faint) shrink-0 w-9 flex justify-end whitespace-nowrap">
                        {formatTime(m.timestamp, timestampFormat)}
                      </span>
                      <span className="text-[13px] font-mono text-(--dolq-text-muted)">
                        📦 <IrcText text={m.text} />
                      </span>
                    </div>
                  ) : m.action ? (
                    <div
                      className={`flex items-baseline gap-3 group hover:bg-(--dolq-bg-row-hover) px-7 ${compact ? 'py-0' : 'py-0.5'}`}
                    >
                      <span className="text-[11px] text-(--dolq-text-faint) shrink-0 w-9 flex justify-end whitespace-nowrap opacity-0 group-hover:opacity-100">
                        {formatTime(m.timestamp, timestampFormat)}
                      </span>
                      <span className="text-[15px] leading-relaxed italic">
                        {asNick(m.nick, `* ${m.nick}`, '', { color: nickColor(m.nick) })}{' '}
                        <span className="text-(--dolq-text)">
                          <IrcText text={m.text} />
                        </span>
                      </span>
                    </div>
                  ) : continuesGroup(messages[virtualRow.index - 1], m) ? (
                    <div className="flex gap-3 group hover:bg-(--dolq-bg-row-hover) px-7 py-px">
                      <span className="text-[11px] leading-6 text-(--dolq-text-faint) shrink-0 w-9 flex justify-end whitespace-nowrap opacity-0 group-hover:opacity-100 tabular-nums">
                        {formatTime(m.timestamp, timestampFormat)}
                      </span>
                      <span className="min-w-0 flex-1 text-(--dolq-text) text-[15px] leading-6">
                        <IrcText text={m.text} />
                      </span>
                    </div>
                  ) : (
                    <div
                      className={`flex gap-3 hover:bg-(--dolq-bg-row-hover) px-7 pb-px ${compact ? 'pt-1.5' : 'pt-3.5'}`}
                    >
                      {asNick(
                        m.nick,
                        nickInitial(m.nick),
                        'w-9 h-9 rounded-full text-white text-sm font-semibold flex items-center justify-center shrink-0',
                        { background: nickColor(m.nick) },
                        true,
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          {asNick(m.nick, m.nick, 'font-semibold text-[14px]', { color: nickColor(m.nick) })}
                          <span className="text-[12px] text-(--dolq-text-dim)">
                            {formatTime(m.timestamp, timestampFormat)}
                          </span>
                        </div>
                        <div className="text-(--dolq-text) text-[15px] leading-6">
                          <IrcText text={m.text} />
                        </div>
                      </div>
                    </div>
                  )}
                  {!folded && !m.system && !m.xdccPack && m.text && (
                    <CopyMessage text={m.text} group={groupAround(messages, virtualRow.index).map((g) => g.text)} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {nickMenu.menu && nickActions && (
        <NickMenu
          x={nickMenu.menu.x}
          y={nickMenu.menu.y}
          nick={nickMenu.menu.target}
          actions={nickActions}
          close={nickMenu.close}
        />
      )}
      {awayFromBottom && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-(--dolq-border-strong) bg-(--dolq-bg-raised) py-1.5 pr-3 pl-2.5 text-[12px] font-medium text-(--dolq-text-dim) shadow-md transition-colors hover:text-(--dolq-text)"
        >
          <Icon name="chevronDown" size={14} />
          Jump to latest
        </button>
      )}
    </div>
  );
}
