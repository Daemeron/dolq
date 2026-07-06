import { useEffect, useRef, useState } from 'react';
import { MOCK_USERS, type Message } from './DummyData';
import { useStore } from './store';
import { ServerList } from './components/ServerList';
import { ChannelList } from './components/ChannelList';
import { TopicBar } from './components/TopicBar';
import { MessageArea } from './components/MessageArea';
import { UserList } from './components/UserList';
import { MessageInput } from './components/MessageInput';
import { ConnectModal, type ConnectForm } from './components/ConnectModal';

export default function App() {
  const {
    servers, channelMap, messageMap, nickMap,
    selectedServerId, selectedChannelId,
    addServer, appendMessage, setNick, selectServer, selectChannel,
  } = useStore();

  const [showModal, setShowModal] = useState(false);
  const connectedServerIdRef = useRef<string | null>(null);
  const nextMsgId = useRef(Date.now());

  useEffect(() => {
    return window.irc.onLine((line) => {
      const sid = connectedServerIdRef.current;
      if (!sid) return;
      const key = `${sid}:__log__`;
      const msg: Message = {
        id: nextMsgId.current++,
        nick: '',
        text: line,
        timestamp: new Date(),
        isRaw: true,
      };
      appendMessage(key, msg);
    });
  }, [appendMessage]);

  async function handleConnect(form: ConnectForm) {
    const id = `${form.host}:${form.port}`;
    addServer(
      { id, name: form.name, initial: form.name[0]?.toUpperCase() ?? '?' },
      { id: `${id}:__log__`, name: 'Log', isLog: true },
    );
    setNick(id, form.nick);
    connectedServerIdRef.current = id;
    await window.irc.connect(form.host, Number(form.port), form.nick);
    selectServer(id);
    setShowModal(false);
  }

  const channels = channelMap[selectedServerId] ?? [];
  const selectedChannel = channels.find((c) => c.id === selectedChannelId) ?? channels[0];
  const messages = messageMap[selectedChannelId] ?? [];
  const users = MOCK_USERS[selectedChannelId] ?? [];
  const isLog = selectedChannel?.isLog ?? false;
  const currentNick = nickMap[selectedServerId] ?? 'reecord_user';

  async function handleSend(text: string): Promise<void> {
    const line = selectedChannel?.isLog ? text : `PRIVMSG ${selectedChannelId} :${text}`;
    await window.irc.sendLine(line);
  }

  return (
    <div className="flex w-full h-screen overflow-hidden">
      {showModal && (
        <ConnectModal onConnect={handleConnect} onCancel={() => setShowModal(false)} />
      )}
      <ServerList
        servers={servers}
        selectedId={selectedServerId}
        onSelect={selectServer}
        onAddServer={() => setShowModal(true)}
      />
      <ChannelList
        serverName={(servers.find((s) => s.id === selectedServerId))?.name ?? ''}
        channels={channels}
        selectedId={selectedChannelId}
        onSelect={selectChannel}
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
