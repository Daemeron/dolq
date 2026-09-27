import { useVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef } from 'react';
import type { Message } from '../types';
import { IrcText } from './IrcText';

type Props = {
  messages: Message[];
  isLog: boolean;
  channelId: string;
  onLoadOlder?: () => void;
  timestampFormat: '12h' | '24h';
  density: 'cozy' | 'compact';
  onGetPack?: (nick: string, packNumber: number) => void;
};

const NICK_COLORS = ['#82aaff', '#50fa7b', '#ff5555', '#ffcb6b', '#b0b0b0', '#8be9fd', '#ff92df', '#c792ea'];

function nickColor(nick: string): string {
  let hash = 0;
  for (let i = 0; i < nick.length; i++) hash = nick.charCodeAt(i) + ((hash << 5) - hash);
  return NICK_COLORS[Math.abs(hash) % NICK_COLORS.length];
}

function formatTime(d: Date, timestampFormat: '12h' | '24h'): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: timestampFormat === '12h' });
}

const AT_BOTTOM_THRESHOLD = 40;
const LOAD_OLDER_THRESHOLD = 100;

export function MessageArea({ messages, isLog, channelId, onLoadOlder, timestampFormat, density, onGetPack }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevChannelId = useRef(channelId);
  const scrollTop = useRef<Map<string, number>>(new Map());
  const isAtBottom = useRef<Map<string, boolean>>(new Map());

  const switchedChannel = prevChannelId.current !== channelId;
  const compact = density === 'compact';
  const rowEstimate = isLog ? 20 : compact ? 22 : 28;

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowEstimate,
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
        el.scrollTop = wasAtBottom ? el.scrollHeight : (scrollTop.current.get(channelId) ?? el.scrollHeight);
      }
    }
    prevChannelId.current = channelId;
  }, [channelId, switchedChannel]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    scrollTop.current.set(channelId, el.scrollTop);
    isAtBottom.current.set(channelId, el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_THRESHOLD);
    if (onLoadOlder && el.scrollTop < LOAD_OLDER_THRESHOLD) onLoadOlder();
  }

  const virtualRows = rowVirtualizer.getVirtualItems();

  if (messages.length === 0) {
    return (
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4 scroll-thin">
        <p
          className={
            isLog ? 'text-(--dolq-text-faint) text-[14px]' : 'text-(--dolq-text-faint) text-[14px] text-center mt-8'
          }
        >
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
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {isLog ? (
                <div className="font-mono text-[12px] leading-5 text-(--dolq-text) whitespace-pre-wrap break-all">
                  <span className="text-(--dolq-text-faint) mr-3">{formatTime(m.timestamp, timestampFormat)}</span>
                  <IrcText text={m.text} />
                </div>
              ) : m.system ? (
                <div className={`flex items-baseline gap-3 px-2 ${compact ? 'py-0' : 'py-1'}`}>
                  <span className="text-[11px] text-(--dolq-text-faint) shrink-0 w-10 text-right">
                    {formatTime(m.timestamp, timestampFormat)}
                  </span>
                  <span className="text-(--dolq-text-faint) text-[13px] italic">
                    <IrcText text={m.text} />
                  </span>
                </div>
              ) : m.notice ? (
                <div className={`flex items-baseline gap-3 px-2 ${compact ? 'py-0' : 'py-0.5'}`}>
                  <span className="text-[11px] text-(--dolq-text-faint) shrink-0 w-10 text-right">
                    {formatTime(m.timestamp, timestampFormat)}
                  </span>
                  <span className="text-[13px] italic text-(--dolq-text-dim)">
                    <span style={{ color: nickColor(m.nick) }}>-{m.nick}-</span> <IrcText text={m.text} />
                  </span>
                </div>
              ) : m.xdccPack ? (
                <div
                  className={`flex items-baseline gap-3 px-2 rounded ${compact ? 'py-0' : 'py-0.5'} ${
                    onGetPack && m.xdccPackNumber != null ? 'cursor-pointer hover:bg-[rgba(4,4,5,0.07)]' : ''
                  }`}
                  onClick={() => {
                    if (onGetPack && m.xdccPackNumber != null) onGetPack(m.nick, m.xdccPackNumber);
                  }}
                  title={onGetPack ? 'Click to request this pack' : undefined}
                >
                  <span className="text-[11px] text-(--dolq-text-faint) shrink-0 w-10 text-right">
                    {formatTime(m.timestamp, timestampFormat)}
                  </span>
                  <span className="text-[13px] font-mono text-(--dolq-text-muted)">
                    📦 <IrcText text={m.text} />
                  </span>
                </div>
              ) : m.action ? (
                <div
                  className={`flex items-baseline gap-3 group hover:bg-[rgba(4,4,5,0.07)] px-2 rounded ${compact ? 'py-0' : 'py-0.5'}`}
                >
                  <span className="text-[11px] text-(--dolq-text-faint) shrink-0 w-10 text-right opacity-0 group-hover:opacity-100">
                    {formatTime(m.timestamp, timestampFormat)}
                  </span>
                  <span className="text-[15px] leading-relaxed italic">
                    <span style={{ color: nickColor(m.nick) }}>* {m.nick}</span>{' '}
                    <span className="text-(--dolq-text)">
                      <IrcText text={m.text} />
                    </span>
                  </span>
                </div>
              ) : (
                <div
                  className={`flex items-baseline gap-3 group hover:bg-[rgba(4,4,5,0.07)] px-2 rounded ${compact ? 'py-0' : 'py-0.5'}`}
                >
                  <span className="text-[11px] text-(--dolq-text-faint) shrink-0 w-10 text-right opacity-0 group-hover:opacity-100">
                    {formatTime(m.timestamp, timestampFormat)}
                  </span>
                  <span className="font-semibold text-[14px] shrink-0" style={{ color: nickColor(m.nick) }}>
                    {m.nick}
                  </span>
                  <span className="text-(--dolq-text) text-[15px] leading-relaxed">
                    <IrcText text={m.text} />
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
