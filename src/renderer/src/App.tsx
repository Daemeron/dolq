import { useEffect, useRef, useState } from 'react';
import {
  MOCK_SERVERS, MOCK_CHANNELS, MOCK_MESSAGES, MOCK_USERS,
  type Server, type Channel, type Message,
} from './DummyData';
import { ServerList } from './components/ServerList';
import { ChannelList } from './components/ChannelList';
import { TopicBar } from './components/TopicBar';
import { MessageArea } from './components/MessageArea';
import { UserList } from './components/UserList';
import { MessageInput } from './components/MessageInput';
import { ConnectModal, type ConnectForm } from './components/ConnectModal';

export default function App() {
  const [servers, setServers] = useState<Server[]>(MOCK_SERVERS);
  const [channelMap, setChannelMap] = useState<Record<string, Channel[]>>(MOCK_CHANNELS);
  const [messageMap, setMessageMap] = useState<Record<string, Message[]>>(MOCK_MESSAGES);
  const [nickMap, setNickMap] = useState<Record<string, string>>({
    libera: 'reecord_user',
    ircnet: 'reecord_user',
  });
  const [selectedServerId, setSelectedServerId] = useState(MOCK_SERVERS[0].id);
  const [selectedChannelId, setSelectedChannelId] = useState('__log__');
  const [showModal, setShowModal] = useState(false);

  const connectedServerIdRef = useRef<string | null>(null);
  const nextMsgId = useRef(Date.now());

  useEffect(() => {
    return window.irc.onLine((line) => {
      const sid = connectedServerIdRef.current;
      if (!sid) return;
      const logKey = `${sid}:__log__`;
      const msg: Message = {
        id: nextMsgId.current++,
        nick: '',
        text: line,
        timestamp: new Date(),
        isRaw: true,
      };
      setMessageMap((prev) => ({
        ...prev,
        [logKey]: [...(prev[logKey] ?? []), msg],
      }));
    });
  }, []);

  async function handleConnect(form: ConnectForm) {
    const id = `${form.host}:${form.port}`;
    const logKey = `${id}:__log__`;

    const newServer: Server = {
      id,
      name: form.name,
      initial: form.name[0]?.toUpperCase() ?? '?',
    };
    const logChannel: Channel = { id: logKey, name: 'Log', isLog: true };

    setServers((prev) => [...prev, newServer]);
    setChannelMap((prev) => ({ ...prev, [id]: [logChannel] }));
    setMessageMap((prev) => ({ ...prev, [logKey]: [] }));
    setNickMap((prev) => ({ ...prev, [id]: form.nick }));

    connectedServerIdRef.current = id;
    await window.irc.connect(form.host, Number(form.port), form.nick);

    setSelectedServerId(id);
    setSelectedChannelId(logKey);
    setShowModal(false);
  }

  function handleSelectServer(id: string) {
    setSelectedServerId(id);
    const channels = channelMap[id] ?? [];
    const logCh = channels.find((c) => c.isLog);
    setSelectedChannelId(logCh?.id ?? channels[0]?.id ?? '__log__');
  }

  async function handleSend(text: string): Promise<void> {
    const selectedChannel = (channelMap[selectedServerId] ?? []).find(
      (c) => c.id === selectedChannelId,
    );
    const line = selectedChannel?.isLog
      ? text
      : `PRIVMSG ${selectedChannelId} :${text}`;
    await window.irc.sendLine(line);
  }

  const channels = channelMap[selectedServerId] ?? [];
  const selectedChannel = channels.find((c) => c.id === selectedChannelId) ?? channels[0];
  const messages = messageMap[selectedChannelId] ?? [];
  const users = MOCK_USERS[selectedChannelId] ?? [];
  const isLog = selectedChannel?.isLog ?? false;
  const currentNick = nickMap[selectedServerId] ?? 'reecord_user';

  return (
    <div className="flex w-full h-screen overflow-hidden">
      {showModal && (
        <ConnectModal onConnect={handleConnect} onCancel={() => setShowModal(false)} />
      )}

      <ServerList
        servers={servers}
        selectedId={selectedServerId}
        onSelect={handleSelectServer}
        onAddServer={() => setShowModal(true)}
      />
      <ChannelList
        serverName={(servers.find((s) => s.id === selectedServerId))?.name ?? ''}
        channels={channels}
        selectedId={selectedChannelId}
        onSelect={setSelectedChannelId}
        currentNick={currentNick}
      />
      <main className="flex flex-col flex-1 bg-[#36393f] overflow-hidden">
        <TopicBar
          channelName={selectedChannel?.name ?? ''}
          topic={selectedChannel?.topic}
          isLog={isLog}
        />
        <div className="flex flex-1 overflow-hidden">
          <MessageArea messages={messages} isLog={isLog} />
          {!isLog && <UserList users={users} />}
        </div>
        <MessageInput
          channelName={selectedChannel?.name ?? ''}
          isLog={isLog}
          onSend={handleSend}
        />
      </main>
    </div>
  );
}
