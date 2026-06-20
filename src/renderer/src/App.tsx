import { useEffect, useRef, useState } from 'react';
import type { Message } from './DummyData';
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
    servers, channelMap, messageMap, userMap, nickMap,
    selectedServerId, selectedChannelId, statusMap,
    addServer, addChannel, appendMessage, setNick, selectServer, selectChannel, setConnectionStatus,
    setUsers, addUser, removeUser, removeUserEverywhere, renameUserEverywhere,
  } = useStore();

  const [showModal, setShowModal] = useState(false);
  const nextMsgId = useRef(Date.now());

  useEffect(() => {
    return window.irc.onStatus((serverId, status) => setConnectionStatus(serverId, status));
  }, [setConnectionStatus]);

  useEffect(() => {
    return window.irc.onLine((serverId, line) => {
      const key = `${serverId}:__log__`;
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

  useEffect(() => {
    return window.irc.onEvent((serverId, event) => {
      switch (event.type) {
        case 'PRIVMSG':
          appendMessage(event.target, {
            id: nextMsgId.current++, nick: event.nick, text: event.text, timestamp: new Date(),
          });
          break;
        case 'JOIN':
          if (event.nick === nickMap[serverId]) {
            addChannel(serverId, { id: event.channel, name: event.channel.slice(1), isLog: false });
            selectChannel(event.channel);
          } else {
            addUser(event.channel, { nick: event.nick, isOp: false });
          }
          break;
        case 'PART':
          removeUser(event.channel, event.nick);
          break;
        case 'QUIT':
          removeUserEverywhere(event.nick);
          break;
        case 'NICK':
          renameUserEverywhere(event.oldNick, event.newNick);
          break;
        case 'names':
          setUsers(event.channel, event.users);
          break;
      }
    });
  }, [
    appendMessage, addChannel, selectChannel, addUser, removeUser,
    removeUserEverywhere, renameUserEverywhere, setUsers, nickMap,
  ]);

  async function handleConnect(form: ConnectForm) {
    const id = `${form.host}:${form.port}`;
    addServer(
      { id, name: form.name, initial: form.name[0]?.toUpperCase() ?? '?' },
      { id: `${id}:__log__`, name: 'Log', isLog: true },
    );
    setNick(id, form.nick);
    setConnectionStatus(id, 'connecting');
    await window.irc.connect(id, form.host, Number(form.port), form.nick);
    setConnectionStatus(id, 'connected');
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
    setConnectionStatus(server.id, 'connecting');
    await window.irc.connect(server.id, host, port, nick);
    setConnectionStatus(server.id, 'connected');
  }

  async function handleDisconnect() {
    await window.irc.disconnect(selectedServerId);
    setConnectionStatus(selectedServerId, 'disconnected');
  }

  const channels = channelMap[selectedServerId] ?? [];
  const selectedChannel = channels.find((c) => c.id === selectedChannelId) ?? channels[0];
  const messages = messageMap[selectedChannelId] ?? [];
  const users = userMap[selectedChannelId] ?? [];
  const isLog = selectedChannel?.isLog ?? false;
  const currentNick = nickMap[selectedServerId] ?? 'reecord_user';
  const connectionStatus = statusMap[selectedServerId] ?? 'disconnected';

  async function handleSend(text: string): Promise<void> {
    const joinMatch = text.match(/^\/join\s+(#\S+)$/);

    if (text === '/connect') {
      if (connectionStatus === 'disconnected') connectToServer();
    } else if (text === '/disconnect') {
      handleDisconnect();
    } else if (joinMatch) {
      await window.irc.sendLine(selectedServerId, `JOIN ${joinMatch[1]}`);
    } else {
      const line = selectedChannel?.isLog ? text : `PRIVMSG ${selectedChannelId} :${text}`;
      await window.irc.sendLine(selectedServerId, line);
    }
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
            <MessageArea messages={messages} isLog={isLog} channelId={selectedChannelId} />
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
