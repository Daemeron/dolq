import { useVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef } from 'react';
import type { Message } from '../types';
import { dayLabel } from '../utils/dayLabel';
import { continuesGroup } from '../utils/groupMessages';
import { mentionsAny } from '../utils/mentions';
import { nickColor, nickInitial } from '../utils/nickColor';
import { IrcText } from './IrcText';

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
};

function formatTime(d: Date, timestampFormat: '12h' | '24h'): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: timestampFormat === '12h' });
}

const AT_BOTTOM_THRESHOLD = 40;
const LOAD_OLDER_THRESHOLD = 100;
// Pages a view may ask for in a row without a scroll, so lines hidden at draw time cannot make it crawl all history.
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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevChannelId = useRef(channelId);
  const scrollTop = useRef<Map<string, number>>(new Map());
  const isAtBottom = useRef<Map<string, boolean>>(new Map());
  const autoLoads = useRef(0);

  const switchedChannel = prevChannelId.current !== channelId;
  const compact = density === 'compact';
  const rowEstimate = isLog ? 20 : compact ? 24 : 30;

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

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
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
                className={mention ? 'bg-(--dolq-accent-soft)' : undefined}
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
                {isLog ? (
                  <div className="font-mono text-[12px] leading-5 text-(--dolq-text) whitespace-pre-wrap break-all px-7">
                    <span className="text-(--dolq-text-faint) mr-3">{formatTime(m.timestamp, timestampFormat)}</span>
                    <IrcText text={m.text} />
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
                      <span style={{ color: nickColor(m.nick) }}>-{m.nick}-</span> <IrcText text={m.text} />
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
                      <span style={{ color: nickColor(m.nick) }}>* {m.nick}</span>{' '}
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
                    <span
                      aria-hidden="true"
                      className="w-9 h-9 rounded-full text-white text-sm font-semibold flex items-center justify-center shrink-0"
                      style={{ background: nickColor(m.nick) }}
                    >
                      {nickInitial(m.nick)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold text-[14px]" style={{ color: nickColor(m.nick) }}>
                          {m.nick}
                        </span>
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
