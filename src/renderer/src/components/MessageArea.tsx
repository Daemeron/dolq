import { useLayoutEffect, useRef } from 'react';
import { Message } from '../DummyData';
import { IrcText } from './IrcText';

type Props = {
  messages: Message[];
  isLog: boolean;
  channelId: string;
};

const NICK_COLORS = [
  '#7289da', '#43b581', '#f04747', '#faa61a',
  '#b9bbbe', '#1abc9c', '#e91e63', '#9c27b0',
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

export function MessageArea({ messages, isLog, channelId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevChannelId = useRef(channelId);
  const scrollTop = useRef<Map<string, number>>(new Map());
  const isAtBottom = useRef<Map<string, boolean>>(new Map());

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const switchedChannel = prevChannelId.current !== channelId;
    prevChannelId.current = channelId;
    const wasAtBottom = isAtBottom.current.get(channelId) !== false;

    if (switchedChannel && !wasAtBottom) {
      el.scrollTop = scrollTop.current.get(channelId) ?? el.scrollHeight;
    } else if (wasAtBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: switchedChannel ? 'auto' : 'smooth' });
    }
  }, [messages, channelId]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    scrollTop.current.set(channelId, el.scrollTop);
    isAtBottom.current.set(
      channelId,
      el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_THRESHOLD,
    );
  }

  if (isLog) {
    return (
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4 messages">
        {messages.length === 0 ? (
          <p className="text-[#72767d] text-[14px]">No traffic yet.</p>
        ) : (
          <div className="font-mono text-[12px] leading-5 text-[#dcddde] whitespace-pre-wrap break-all">
            {messages.map((m) => (
              <div key={m.id}>
                <span className="text-[#72767d] mr-3">{formatTime(m.timestamp)}</span>
                <IrcText text={m.text} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4 messages">
      {messages.length === 0 ? (
        <p className="text-[#72767d] text-[14px] text-center mt-8">No messages yet.</p>
      ) : (
        messages.map((m) => (
          <div
            key={m.id}
            className="flex items-baseline gap-3 py-0.5 group hover:bg-[rgba(4,4,5,0.07)] px-2 rounded"
          >
            <span className="text-[11px] text-[#72767d] shrink-0 w-10 text-right opacity-0 group-hover:opacity-100">
              {formatTime(m.timestamp)}
            </span>
            <span
              className="font-semibold text-[14px] shrink-0"
              style={{ color: nickColor(m.nick) }}
            >
              {m.nick}
            </span>
            <span className="text-[#dcddde] text-[15px] leading-relaxed"><IrcText text={m.text} /></span>
          </div>
        ))
      )}
    </div>
  );
}
