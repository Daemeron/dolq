import React, { useEffect, useRef, useState } from 'react';
import './App.css';
import { IrcLogEntry, IrcLogPanel } from './IrcLogPanel';

type Message = {
  id: number;
  raw: string;
  nick: string;
  channel: string;
  text: string;
  timestamp: Date;
};

type ConnectForm = {
  host: string;
  port: string;
  nick: string;
};

const DEMO_SERVERS = [{ id: '127.0.0.1', label: 'L', name: 'Localhost' }];

function parseIrcLine(raw: string): Omit<Message, 'id' | 'raw' | 'timestamp'> | null {
  const privmsg = raw.match(/^:([^!]+)![^\s]+ PRIVMSG ([^\s]+) :(.*)$/);
  if (privmsg) {
    return { nick: privmsg[1], channel: privmsg[2], text: privmsg[3] };
  }
  return null;
}

const inputClass =
  'bg-[#40444b] border border-[#202225] rounded text-[#dcddde] text-[15px] px-3 py-[10px] outline-none transition-colors duration-150 focus:border-[#7289da]';

const labelClass =
  'flex flex-col text-left text-xs font-bold uppercase tracking-[0.5px] text-[#b9bbbe] gap-1.5';

export default function App() {
  const [connected, setConnected] = useState(false);
  const [channels, setChannels] = useState<string[]>([]);
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [form, setForm] = useState<ConnectForm>({ host: 'irc.libera.chat', port: '6667', nick: 'reecord_user' });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);
  const [ircLog, setIrcLog] = useState<IrcLogEntry[]>([]);

  useEffect(() => {
    const removeListener = window.irc.onLine((raw: string) => {
      const parsed = parseIrcLine(raw);
      if (parsed) {
        const msg: Message = { id: nextId.current++, raw, timestamp: new Date(), ...parsed };
        setMessages((prev) => [...prev, msg]);
        if (!channels.includes(parsed.channel)) {
          setChannels((prev) => [...prev, parsed.channel]);
        }
      }
    });
    return removeListener;
  }, [channels]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const removeListener = window.irc.onLine((raw: string) => {
      const timestamp = new Date();
      setIrcLog((prev) => [...prev, { id: nextId.current++, raw, timestamp }]);

      const parsed = parseIrcLine(raw);
      if (parsed) {
        const msg: Message = { id: nextId.current++, raw, timestamp, ...parsed };
        setMessages((prev) => [...prev, msg]);
        setChannels((prev) => (prev.includes(parsed.channel) ? prev : [...prev, parsed.channel]));
      }
    });

    return removeListener;
  }, []);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    await window.irc.connect(form.host, parseInt(form.port), form.nick);
    setConnected(true);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !activeChannel) return;

    if (input.startsWith('/')) {
      await window.irc.sendLine(input.slice(1));
    } else {
      await window.irc.sendLine(`PRIVMSG ${activeChannel} :${input}`);
      const msg: Message = {
        id: nextId.current++,
        raw: '',
        nick: form.nick,
        channel: activeChannel,
        text: input,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, msg]);
    }
    setInput('');
  }

  const channelMessages = messages.filter((m) => m.channel === activeChannel);

  if (!connected) {
    return (
      <div className="flex items-center justify-center w-full h-screen bg-[#36393f]">
        <div className="bg-[#2f3136] rounded-lg px-12 py-10 w-440px text-center shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          <h1 className="text-[28px] font-bold text-white tracking-[-0.5px]">Reecord</h1>
          <p className="text-[#72767d] mt-1 mb-7 text-sm">IRC — Discord style</p>
          <form onSubmit={handleConnect} className="flex flex-col gap-4">
            <label className={labelClass}>
              Server
              <input
                className={inputClass}
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="irc.libera.chat"
              />
            </label>
            <label className={labelClass}>
              Port
              <input
                className={inputClass}
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value })}
                placeholder="6667"
                type="number"
              />
            </label>
            <label className={labelClass}>
              Nickname
              <input
                className={inputClass}
                value={form.nick}
                onChange={(e) => setForm({ ...form, nick: e.target.value })}
                placeholder="yournick"
              />
            </label>
            <button
              type="submit"
              className="mt-2 bg-[#7289da] text-white border-none rounded text-[15px] font-semibold py-3 cursor-pointer transition-colors duration-150 hover:bg-[#677bc4]"
            >
              Connect
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full h-screen overflow-hidden">
      {/* Server sidebar */}
      <aside className="flex flex-col items-center gap-2 px-3 py-3 w-72px bg-[#202225] overflow-y-auto shrink-0">
        {DEMO_SERVERS.map((s) => (
          <div
            key={s.id}
            className="w-12 h-12 rounded-full bg-[#36393f] text-[#dcddde] flex items-center justify-center text-[18px] font-bold cursor-pointer transition-[background] duration-200 select-none hover:bg-[#7289da] hover:text-white"
            title={s.name}
          >
            {s.label}
          </div>
        ))}
        <div
          className="w-12 h-12 rounded-full bg-[#36393f] text-[#3ba55d] text-[22px] flex items-center justify-center font-bold cursor-pointer transition-[background] duration-200 select-none hover:bg-[#3ba55d] hover:text-white"
          title="Add server"
        >
          +
        </div>
      </aside>

      {/* Channel sidebar */}
      <aside className="flex flex-col w-60 bg-[#2f3136] shrink-0 overflow-hidden">
        <div className="px-4 h-12 flex items-center font-bold text-[15px] text-white border-b border-[#26282d] shrink-0 shadow-[0_1px_0_rgba(0,0,0,0.2)]">
          <span>{form.host}</span>
        </div>
        <div className="pt-4 pb-1 px-4 text-[11px] font-bold uppercase tracking-[0.5px] text-[#72767d]">
          Text Channels
        </div>
        {channels.map((ch) => (
          <button
            key={ch}
            className={`flex items-center py-5px pl-4 pr-2 my-px mx-2 rounded border-0 text-[15px] cursor-pointer text-left w-[calc(100%-16px)] transition-[background,color] duration-100 ${
              ch === activeChannel
                ? 'bg-[rgba(79,84,92,0.6)] text-white'
                : 'bg-transparent text-[#8e9297] hover:bg-[rgba(79,84,92,0.4)] hover:text-[#dcddde]'
            }`}
            onClick={() => setActiveChannel(ch)}
          >
            # {ch.replace(/^#/, '')}
          </button>
        ))}
        {channels.length === 0 && (
          <p className="py-3 px-4 text-[13px] text-[#72767d] leading-relaxed">
            Join a channel:<br />
            <code>/JOIN #channel</code>
          </p>
        )}
        <div className="mt-auto flex items-center gap-2 p-2 bg-[#292b2f] shrink-0">
          <div className="w-8 h-8 rounded-full bg-[#7289da] text-white flex items-center justify-center font-bold text-sm shrink-0">
            {form.nick[0].toUpperCase()}
          </div>
          <span className="text-[13px] font-semibold text-white truncate">{form.nick}</span>
        </div>
      </aside>

      {/* Main chat area */}
      <main className="flex flex-col flex-1 bg-[#36393f] overflow-hidden">
        {activeChannel ? (
          <>
            <header className="h-12 px-4 flex items-center gap-2 font-bold text-[15px] text-white border-b border-[#26282d] shrink-0 shadow-[0_1px_0_rgba(0,0,0,0.2)]">
              <span className="text-[#72767d] text-xl font-bold">#</span>
              <span>{activeChannel.replace(/^#/, '')}</span>
            </header>

            <div className="messages flex-1 overflow-y-auto py-4 flex flex-col">
              {channelMessages.map((msg) => (
                <div
                  key={msg.id}
                  className="flex items-start gap-4 px-4 py-1 transition-colors duration-100 hover:bg-[rgba(4,4,5,0.07)]"
                >
                  <div className="w-10 h-10 rounded-full bg-[#7289da] text-white flex items-center justify-center font-bold text-base shrink-0 mt-0.5">
                    {msg.nick[0].toUpperCase()}
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-[15px] font-semibold text-white">{msg.nick}</span>
                    <span className="text-[11px] text-[#72767d] ml-2">
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <p className="text-[15px] text-[#dcddde] leading-[1.4] wrap-break-word">{msg.text}</p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            
          </>
        ) : (
          <>
            <div className="flex items-center justify-center flex-0 text-[#72767d] text-[15px] text-center leading-loose">
              <p>Select a channel or join one with <code>/JOIN #channel</code></p>
            </div>
            <div className="flex flex-1 overflow-y-auto py-4 px-4">
              <IrcLogPanel lines={ircLog} />
            </div>
            <form className="px-4 pb-6 pt-6 shrink-0" onSubmit={handleSend}>
              <input
                className="w-full bg-[#40444b] border-0 rounded-lg text-[#dcddde] text-[15px] px-4 py-4 outline-none caret-[#dcddde] placeholder:text-[#72767d]"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={`Message ${activeChannel} — use /COMMAND for raw IRC`}
              />
            </form>
          </>
        )}
      </main>
    </div>
  );
}
