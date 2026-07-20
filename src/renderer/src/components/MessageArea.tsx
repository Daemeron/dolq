import { useLayoutEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Message } from '../types';
import { IrcText } from './IrcText';

type Props = {
  messages: Message[];
  isLog: boolean;
  channelId: string;
  onLoadOlder?: () => void;
};

const NICK_COLORS = [
  '#82aaff', '#50fa7b', '#ff5555', '#ffcb6b',
  '#b0b0b0', '#8be9fd', '#ff92df', '#c792ea',
];

function nickColor(nick: string): string {
  let hash = 0;
  for (let i = 0; i < nick.length; i++) hash = nick.charCodeAt(i) + ((hash << 5) - hash);
  return NICK_COLORS[Math.abs(hash) % NICK_COLORS.length];
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// per-channel scroll memory lives in refs since MessageArea is a single
// always-mounted instance shared across channels (messages/channelId just swap on switch).
const AT_BOTTOM_THRESHOLD = 40;
const LOAD_OLDER_THRESHOLD = 100;

export function MessageArea({ messages, isLog, channelId, onLoadOlder }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevChannelId = useRef(channelId);
  const scrollTop = useRef<Map<string, number>>(new Map());
  const isAtBottom = useRef<Map<string, boolean>>(new Map());

  const switchedChannel = prevChannelId.current !== channelId;

  // Row heights vary (wrapped text), so sizes start as an estimate and get
  // corrected via ResizeObserver after each row mounts. Keying by message id
  // (not index) keeps a prepended older-history page from invalidating every
  // already-measured row below it - only the new rows above are unmeasured.
  // anchorTo/followOnAppend do what the old hand-rolled scrollTop math used
  // to: keep the view pinned to what you were looking at when older history
  // loads in above it, and follow new messages to the bottom only if you were
  // already there - but re-applied on every individual remeasurement instead
  // of once per render, so it doesn't drift once estimated heights are
  // replaced by real ones.
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => (isLog ? 20 : 28),
    getItemKey: (index) => messages[index].id,
    overscan: 8,
    anchorTo: 'end',
    followOnAppend: switchedChannel ? false : 'smooth',
    scrollEndThreshold: AT_BOTTOM_THRESHOLD,
  });

  useLayoutEffect(() => {
    if (switchedChannel) {
      const el = containerRef.current;
      if (el) {
        const wasAtBottom = isAtBottom.current.get(channelId) !== false;
        // Known limitation: this jump uses estimated row heights for the
        // newly-selected channel (nothing's measured yet), so a restored
        // mid-scroll position can settle slightly as real heights come in.
        // Bottom-follow self-corrects (virtual-core re-pins on every
        // remeasure while at end); only fix the restore case too if that
        // settle is noticeable.
        el.scrollTop = wasAtBottom ? el.scrollHeight : scrollTop.current.get(channelId) ?? el.scrollHeight;
      }
    }
    prevChannelId.current = channelId;
  }, [channelId, switchedChannel]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    scrollTop.current.set(channelId, el.scrollTop);
    isAtBottom.current.set(
      channelId,
      el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_THRESHOLD,
    );
    if (onLoadOlder && el.scrollTop < LOAD_OLDER_THRESHOLD) onLoadOlder();
  }

  const virtualRows = rowVirtualizer.getVirtualItems();

  if (messages.length === 0) {
    return (
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4 scroll-thin">
        <p className={isLog ? 'text-[#6b6b6b] text-[14px]' : 'text-[#6b6b6b] text-[14px] text-center mt-8'}>
          {isLog ? 'No traffic yet.' : 'No messages yet.'}
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4 scroll-thin">
      <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
        {virtualRows.map((virtualRow) => {
          const m = messages[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${virtualRow.start}px)` }}
            >
              {isLog ? (
                <div className="font-mono text-[12px] leading-5 text-[#e6e6e6] whitespace-pre-wrap break-all">
                  <span className="text-[#6b6b6b] mr-3">{formatTime(m.timestamp)}</span>
                  <IrcText text={m.text} />
                </div>
              ) : m.system ? (
                <div className="flex items-baseline gap-3 py-1 px-2">
                  <span className="text-[11px] text-[#6b6b6b] shrink-0 w-10 text-right">{formatTime(m.timestamp)}</span>
                  <span className="text-[#6b6b6b] text-[13px] italic"><IrcText text={m.text} /></span>
                </div>
              ) : m.notice ? (
                <div className="flex items-baseline gap-3 py-0.5 px-2">
                  <span className="text-[11px] text-[#6b6b6b] shrink-0 w-10 text-right">{formatTime(m.timestamp)}</span>
                  <span className="text-[13px] italic text-[#909090]">
                    <span style={{ color: nickColor(m.nick) }}>-{m.nick}-</span>{' '}
                    <IrcText text={m.text} />
                  </span>
                </div>
              ) : m.action ? (
                <div className="flex items-baseline gap-3 py-0.5 group hover:bg-[rgba(4,4,5,0.07)] px-2 rounded">
                  <span className="text-[11px] text-[#6b6b6b] shrink-0 w-10 text-right opacity-0 group-hover:opacity-100">
                    {formatTime(m.timestamp)}
                  </span>
                  <span className="text-[15px] leading-relaxed italic">
                    <span style={{ color: nickColor(m.nick) }}>* {m.nick}</span>{' '}
                    <span className="text-[#e6e6e6]"><IrcText text={m.text} /></span>
                  </span>
                </div>
              ) : (
                <div className="flex items-baseline gap-3 py-0.5 group hover:bg-[rgba(4,4,5,0.07)] px-2 rounded">
                  <span className="text-[11px] text-[#6b6b6b] shrink-0 w-10 text-right opacity-0 group-hover:opacity-100">
                    {formatTime(m.timestamp)}
                  </span>
                  <span className="font-semibold text-[14px] shrink-0" style={{ color: nickColor(m.nick) }}>
                    {m.nick}
                  </span>
                  <span className="text-[#e6e6e6] text-[15px] leading-relaxed"><IrcText text={m.text} /></span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
