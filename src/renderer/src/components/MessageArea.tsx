import { useLayoutEffect, useRef } from 'react';
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
  // The oldest message's id and the container's scrollHeight as of the last
  // render, so a prepend (older history loaded in above) can be detected
  // from the data alone and its height compensated for - rather than
  // guessing from scroll-event timing, which races the async fetch between it.
  const prevFirstId = useRef<number | null>(null);
  const prevScrollHeight = useRef(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const switchedChannel = prevChannelId.current !== channelId;
    const prepended =
      !switchedChannel && prevFirstId.current !== null && (messages[0]?.id ?? null) !== prevFirstId.current;

    if (prepended) {
      // Keep whatever the user was looking at in the same spot instead of
      // letting the newly-inserted content above it push the view down.
      el.scrollTop += el.scrollHeight - prevScrollHeight.current;
    } else {
      const wasAtBottom = isAtBottom.current.get(channelId) !== false;
      if (switchedChannel && !wasAtBottom) {
        el.scrollTop = scrollTop.current.get(channelId) ?? el.scrollHeight;
      } else if (wasAtBottom) {
        el.scrollTo({ top: el.scrollHeight, behavior: switchedChannel ? 'auto' : 'smooth' });
      }
    }

    prevChannelId.current = channelId;
    prevFirstId.current = messages[0]?.id ?? null;
    prevScrollHeight.current = el.scrollHeight;
  }, [messages, channelId]);

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

  if (isLog) {
    return (
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4 scroll-thin">
        {messages.length === 0 ? (
          <p className="text-[#6b6b6b] text-[14px]">No traffic yet.</p>
        ) : (
          <div className="font-mono text-[12px] leading-5 text-[#e6e6e6] whitespace-pre-wrap break-all">
            {messages.map((m) => (
              <div key={m.id}>
                <span className="text-[#6b6b6b] mr-3">{formatTime(m.timestamp)}</span>
                <IrcText text={m.text} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4 scroll-thin">
      {messages.length === 0 ? (
        <p className="text-[#6b6b6b] text-[14px] text-center mt-8">No messages yet.</p>
      ) : (
        messages.map((m) =>
          m.system ? (
            <div key={m.id} className="flex items-baseline gap-3 py-1 px-2">
              <span className="text-[11px] text-[#6b6b6b] shrink-0 w-10 text-right">{formatTime(m.timestamp)}</span>
              <span className="text-[#6b6b6b] text-[13px] italic"><IrcText text={m.text} /></span>
            </div>
          ) : (
            <div
              key={m.id}
              className="flex items-baseline gap-3 py-0.5 group hover:bg-[rgba(4,4,5,0.07)] px-2 rounded"
            >
              <span className="text-[11px] text-[#6b6b6b] shrink-0 w-10 text-right opacity-0 group-hover:opacity-100">
                {formatTime(m.timestamp)}
              </span>
              <span
                className="font-semibold text-[14px] shrink-0"
                style={{ color: nickColor(m.nick) }}
              >
                {m.nick}
              </span>
              <span className="text-[#e6e6e6] text-[15px] leading-relaxed"><IrcText text={m.text} /></span>
            </div>
          ),
        )
      )}
    </div>
  );
}
