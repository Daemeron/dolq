import { useEffect, useRef, useState } from 'react';
import type { Message } from './types';
import { useStore } from './store';
import { ServerList } from './components/ServerList';
import { ChannelList } from './components/ChannelList';
import { TopicBar } from './components/TopicBar';
import { MessageArea } from './components/MessageArea';
import { UserList } from './components/UserList';
import { MessageInput } from './components/MessageInput';
import { ConnectModal, type ConnectForm } from './components/ConnectModal';
import { UserPanel } from './components/UserPanel';

export default function App() {
  const {
    servers, presets, channelMap, messageMap, userMap, nickMap,
    selectedServerId, selectedChannelId, statusMap,
    addServer, removeServer, addPreset, addChannel, removeChannel, appendMessage, setNick, selectServer,
    selectChannel, setConnectionStatus, setUsers, addUser, removeUser, removeUserEverywhere, renameUserEverywhere,
    applyModeChanges,
  } = useStore();

  const [showModal, setShowModal] = useState(false);
  const nextMsgId = useRef(Date.now());

  useEffect(() => {
    return window.irc.onStatus((serverId, status) => setConnectionStatus(serverId, status));
  }, [setConnectionStatus]);

  useEffect(() => {
    servers.forEach((s) => {
      window.irc.getStatus(s.id).then((status) => setConnectionStatus(s.id, status));
    });
  }, []);

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
            addUser(event.channel, { nick: event.nick, privilege: 'none' });
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
        case 'MODE':
          applyModeChanges(event.channel, event.changes);
          break;
        case 'names':
          setUsers(event.channel, event.users);
          break;
      }
    });
  }, [
    appendMessage, addChannel, selectChannel, addUser, removeUser,
    removeUserEverywhere, renameUserEverywhere, applyModeChanges, setUsers, nickMap,
  ]);

  async function handleConnect(form: ConnectForm) {
    const id = `${form.host}:${form.port}`;
    addServer(
      { id, name: form.name, initial: form.name[0]?.toUpperCase() ?? '?' },
      { id: `${id}:__log__`, name: 'Log', isLog: true },
    );
    addPreset({ id, name: form.name, host: form.host, port: Number(form.port) });
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

  async function handleRemoveServer(id: string) {
    const server = servers.find((s) => s.id === id);
    if (!confirm(`Remove ${server?.name ?? id}? This clears its local history.`)) return;
    await window.irc.disconnect(id);
    removeServer(id);
  }

  async function handleJoinChannel(channelId: string) {
    await window.irc.sendLine(selectedServerId, `JOIN ${channelId}`);
  }

  async function handleLeaveChannel(channelId: string) {
    await window.irc.sendLine(selectedServerId, `PART ${channelId}`);
  }

  async function handleRemoveChannel(channelId: string) {
    const joined = (userMap[channelId] ?? []).some((u) => u.nick === currentNick);
    if (joined) await window.irc.sendLine(selectedServerId, `PART ${channelId}`);
    removeChannel(selectedServerId, channelId);
  }

  const channels = channelMap[selectedServerId] ?? [];
  const selectedChannel = channels.find((c) => c.id === selectedChannelId) ?? channels[0];
  const messages = messageMap[selectedChannelId] ?? [];
  const users = userMap[selectedChannelId] ?? [];
  const isLog = selectedChannel?.isLog ?? true;
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
    } else if (selectedChannel?.isLog) {
      await window.irc.sendLine(selectedServerId, text);
    } else {
      await window.irc.sendLine(selectedServerId, `PRIVMSG ${selectedChannelId} :${text}`);
      appendMessage(selectedChannelId, {
        id: nextMsgId.current++, nick: currentNick, text, timestamp: new Date(),
      });
    }
  }

  return (
    <div className="flex w-full h-screen overflow-hidden">
      {showModal && (
        <ConnectModal
          presets={presets}
          nickMap={nickMap}
          onConnect={handleConnect}
          onCancel={() => setShowModal(false)}
        />
      )}
      <div className="relative flex flex-col shrink-0">
        <div className="flex flex-1 overflow-hidden">
          <ServerList
            servers={servers}
            selectedId={selectedServerId}
            onSelect={selectServer}
            onAddServer={() => setShowModal(true)}
            onRemove={handleRemoveServer}
          />
          <ChannelList
            serverName={(servers.find((s) => s.id === selectedServerId))?.name ?? ''}
            channels={channels}
            selectedId={selectedChannelId}
            onSelect={selectChannel}
            currentNick={currentNick}
            userMap={userMap}
            onJoinChannel={handleJoinChannel}
            onLeaveChannel={handleLeaveChannel}
            onRemoveChannel={handleRemoveChannel}
          />
        </div>
        <div className="absolute bottom-0 left-0 w-full px-3 pt-2 pb-2">
          <UserPanel
            currentNick={currentNick}
            connectionStatus={connectionStatus}
            onConnect={connectToServer}
            onDisconnect={handleDisconnect}
          />
        </div>
      </div>
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
          <aside className="w-52 bg-[#2f3136] border-l border-[#26282d] shrink-0 flex flex-col overflow-hidden">
            {!isLog && (
              <div className="flex-1 min-h-0 overflow-y-auto pt-4 pb-6 px-2 scroll-thin">
                <UserList users={users} />
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
