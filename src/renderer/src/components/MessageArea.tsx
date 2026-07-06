import { useEffect, useRef } from 'react';
import { Message } from '../DummyData';
import { IrcText } from './IrcText';

type Props = {
  messages: Message[];
  isLog: boolean;
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

export function MessageArea({ messages, isLog }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, [messages]);

  if (isLog) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-4 messages">
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
        <div ref={bottomRef} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 messages">
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
      <div ref={bottomRef} />
    </div>
  );
}
