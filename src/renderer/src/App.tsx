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
    selectedServerId, selectedChannelId, connectionStatus,
    addServer, appendMessage, setNick, selectServer, selectChannel, setConnectionStatus,
  } = useStore();

  const [showModal, setShowModal] = useState(false);
  const connectedServerIdRef = useRef<string | null>(null);
  const nextMsgId = useRef(Date.now());

  useEffect(() => {
    return window.irc.onStatus((status) => setConnectionStatus(status));
  }, [setConnectionStatus]);

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
    setConnectionStatus('connecting');
    await window.irc.connect(form.host, Number(form.port), form.nick);
    setConnectionStatus('connected');
    selectServer(id);
    setShowModal(false);
  }

  async function connectToServer() {
    const server = servers.find((s) => s.id === selectedServerId);
    if (!server) return;
    const lastColon = server.id.lastIndexOf(':');
    const host = server.id.slice(0, lastColon);
    const port = Number(server.id.slice(lastColon + 1));
    const nick = nickMap[server.id] ?? 'reecord_user';
    connectedServerIdRef.current = server.id;
    setConnectionStatus('connecting');
    await window.irc.connect(host, port, nick);
    setConnectionStatus('connected');
  }

  async function handleDisconnect() {
    await window.irc.disconnect();
    setConnectionStatus('disconnected');
  }

  const channels = channelMap[selectedServerId] ?? [];
  const selectedChannel = channels.find((c) => c.id === selectedChannelId) ?? channels[0];
  const messages = messageMap[selectedChannelId] ?? [];
  const users = MOCK_USERS[selectedChannelId] ?? [];
  const isLog = selectedChannel?.isLog ?? false;
  const currentNick = nickMap[selectedServerId] ?? 'reecord_user';

  async function handleSend(text: string): Promise<void> {
    if (text === '/connect') { connectToServer(); return; }
    if (text === '/disconnect') { handleDisconnect(); return; }
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
        connectionStatus={connectionStatus}
        onConnect={connectToServer}
        onDisconnect={handleDisconnect}
      />
      <main className="flex flex-col flex-1 bg-[#36393f] overflow-hidden">
        <TopicBar
          channelName={selectedChannel?.name ?? ''}
          topic={selectedChannel?.topic}
          isLog={isLog}
        />
        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-col flex-1 overflow-hidden">
            <MessageArea messages={messages} isLog={isLog} />
            <MessageInput
              channelName={selectedChannel?.name ?? ''}
              isLog={isLog}
              onSend={handleSend}
            />
          </div>
          <aside className="w-52 bg-[#2f3136] border-l border-[#26282d] shrink-0 flex flex-col">
            {!isLog && (
              <div className="flex-1 overflow-y-auto py-4 px-2">
                <UserList users={users} />
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
