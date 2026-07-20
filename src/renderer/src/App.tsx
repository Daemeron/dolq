import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from './types';
import type { HistoryEntry } from '../../shared/ipc';
import { useStore } from './store';
import { ServerList } from './components/ServerList';
import { ChannelList } from './components/ChannelList';
import { TopicBar } from './components/TopicBar';
import { MessageArea } from './components/MessageArea';
import { UserList } from './components/UserList';
import { MessageInput } from './components/MessageInput';
import { ConnectModal, type ConnectForm } from './components/ConnectModal';
import { UserPanel } from './components/UserPanel';
import { buildServerId, parseServerId } from './utils/server';

// How many rows getHistory fetches per page - both for the initial preload
// and each scroll-up-triggered older page. Also doubles as the "is there
// more?" signal: fewer than this many back means we've hit the beginning.
const HISTORY_PAGE_SIZE = 100;

// The backend persists every raw line and every parsed event, not just
// what's renderable today - same as the live onLine/onEvent handlers below,
// only PRIVMSG/ACTION/NOTICE (and raw lines, for the Log channel) currently
// become a Message. Add a case here (and in the matching onEvent switch
// below) as more event types grow their own scrollback rendering.
//
// A private (non-channel) NOTICE is deliberately skipped here: it buckets
// into the same "__log__" history as raw lines (see bouncer.eventChannel),
// which already contains the raw NOTICE line itself - rendering the parsed
// event too would show it twice. Channel notices bucket separately, so no
// such overlap there.
function toMessages(entries: HistoryEntry[]): Message[] {
  const messages: Message[] = [];
  for (const e of entries) {
    const timestamp = new Date(e.timestamp);
    if (e.isRaw) {
      messages.push({ id: e.id, nick: '', text: e.line ?? '', timestamp, isRaw: true });
    } else if (e.event?.type === 'PRIVMSG') {
      messages.push({ id: e.id, nick: e.event.nick, text: e.event.text, timestamp });
    } else if (e.event?.type === 'ACTION') {
      messages.push({ id: e.id, nick: e.event.nick, text: e.event.text, timestamp, action: true });
    } else if (e.event?.type === 'NOTICE' && e.event.target.startsWith('#')) {
      messages.push({ id: e.id, nick: e.event.nick, text: e.event.text, timestamp, notice: true });
    }
  }
  return messages;
}

// Per-channel scrollback paging state - bookkeeping, not render state, so
// it lives outside the (unpersisted) store like historyLoaded did before it.
type HistoryPage = { oldestId: number | null; exhausted: boolean; loading: boolean };

export default function App() {
  const {
    servers, presets, channelMap, messageMap, userMap, nickMap, saslMap,
    selectedServerId, selectedChannelId, statusMap,
    addServer, removeServer, addPreset, addChannel, removeChannel, setTopic, setTopicWhoTime, appendMessage, setHistory, setNick, setSaslCreds,
    selectServer, selectChannel, setConnectionStatus, setUsers, addUser, removeUser, removeUserEverywhere,
    renameUserEverywhere, applyModeChanges,
  } = useStore();

  const [showModal, setShowModal] = useState(false);
  const nextMsgId = useRef(Date.now());
  const historyPages = useRef(new Map<string, HistoryPage>());

  // Both the initial preload and loadOlderHistory below need the bare
  // '__log__' key the backend stores raw lines under - the "__log__" suffix
  // is only ever added to the messageMap/UI-facing channel id.
  function backendChannelFor(serverId: string, channelId: string): string {
    const channel = channelMap[serverId]?.find((c) => c.id === channelId);
    return channel?.isLog ? '__log__' : channelId;
  }

  useEffect(() => {
    return window.irc.onStatus((serverId, status) => setConnectionStatus(serverId, status));
  }, [setConnectionStatus]);

  // statusMap AND userMap aren't persisted, so both reset to empty on any
  // renderer-only reload (e.g. dev-mode HMR) even though the main process's live
  // connections (and their joined channels) survive it untouched. Reconcile once
  // hydration finishes: for a channel we're actually still in, re-request NAMES so
  // the existing 353/366 pipeline repopulates its user list (there's nothing to
  // "fix" for a channel we're no longer in - an empty userMap already shows it
  // correctly as not-joined, e.g. after a KICK that happened while no renderer was
  // listening). Reading via getState() (not the destructured `servers`) matters
  // because persist rehydration is always async, even with synchronous
  // localStorage - a `[]`-deps effect fires before it resolves, so the closed-over
  // `servers` would still be the pre-hydration empty array.
  useEffect(() => {
    async function reconcile() {
      const { servers, channelMap } = useStore.getState();
      for (const s of servers) {
        const status = await window.irc.getStatus(s.id);
        setConnectionStatus(s.id, status);
        if (status !== 'connected') continue;

        const joined = new Set(await window.irc.getJoinedChannels(s.id));
        (channelMap[s.id] ?? []).forEach((ch) => {
          if (!ch.isLog && joined.has(ch.id)) window.irc.sendLine(s.id, `NAMES ${ch.id}`);
        });
      }
    }
    if (useStore.persist.hasHydrated()) {
      reconcile();
      return;
    }
    return useStore.persist.onFinishHydration(reconcile);
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

  // Opens a query with `nick` if one isn't already open - there's no
  // protocol-level "start a DM" beyond just sending/receiving a PRIVMSG, so
  // this only touches local state.
  function ensureQuery(serverId: string, nick: string) {
    if (!(channelMap[serverId] ?? []).some((c) => c.id === nick)) {
      addChannel(serverId, { id: nick, name: nick, isLog: false, isQuery: true });
    }
  }

  // A non-channel PRIVMSG/ACTION target is always our own nick (that's the
  // only way we'd ever receive one) - bucket those by sender instead so both
  // directions of a DM land in the same query, auto-opening it like a
  // channel auto-joins on JOIN. Doesn't steal focus, unlike JOIN, since
  // receiving a DM isn't something we did.
  function dmKey(serverId: string, target: string, nick: string): string {
    if (target.startsWith('#')) return target;
    ensureQuery(serverId, nick);
    return nick;
  }

  useEffect(() => {
    return window.irc.onEvent((serverId, event) => {
      switch (event.type) {
        case 'PRIVMSG':
          appendMessage(dmKey(serverId, event.target, event.nick), {
            id: nextMsgId.current++, nick: event.nick, text: event.text, timestamp: new Date(),
          });
          break;
        case 'ACTION':
          appendMessage(dmKey(serverId, event.target, event.nick), {
            id: nextMsgId.current++, nick: event.nick, text: event.text, timestamp: new Date(), action: true,
          });
          break;
        case 'NOTICE':
          // A private NOTICE isn't routed anywhere here - it already shows
          // up as a raw line in the Log (onLine above), same as before this
          // was parsed at all. Only channel notices get the nicer per-channel
          // rendering, same reasoning as toMessages above.
          if (event.target.startsWith('#')) {
            appendMessage(event.target, {
              id: nextMsgId.current++, nick: event.nick, text: event.text, timestamp: new Date(), notice: true,
            });
          }
          break;
        case 'JOIN':
          if (event.nick === nickMap[serverId]) {
            addChannel(serverId, { id: event.channel, name: event.channel.slice(1), isLog: false });
            selectChannel(event.channel);
          } else {
            addUser(event.channel, { nick: event.nick, privileges: [] });
          }
          break;
        case 'PART':
          removeUser(event.channel, event.nick);
          break;
        case 'KICK':
          removeUser(event.channel, event.nick);
          if (event.nick === nickMap[serverId]) {
            appendMessage(event.channel, {
              id: nextMsgId.current++,
              nick: '',
              text: `You were kicked by ${event.by}${event.reason ? `: ${event.reason}` : ''}`,
              timestamp: new Date(),
              system: true,
            });
          }
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
        case 'TOPIC':
          setTopic(serverId, event.channel, event.topic);
          // A live change (unlike the 332 numeric on join) carries who did it -
          // servers don't follow up with a 333 for this, so record it here too.
          if (event.nick) setTopicWhoTime(serverId, event.channel, event.nick, new Date());
          break;
        case 'TOPICWHOTIME':
          setTopicWhoTime(serverId, event.channel, event.nick, new Date(event.setAt * 1000));
          break;
      }
    });
  }, [
    appendMessage, addChannel, selectChannel, addUser, removeUser,
    removeUserEverywhere, renameUserEverywhere, applyModeChanges, setUsers, setTopic, setTopicWhoTime, nickMap,
    channelMap,
  ]);

  // Preload scrollback the first time a channel is actually opened - once
  // per channel per session, tracked outside the (unpersisted) store so it
  // survives messageMap already being seeded to [] at channel-creation time.
  useEffect(() => {
    if (!selectedServerId || historyPages.current.has(selectedChannelId)) return;
    const page: HistoryPage = { oldestId: null, exhausted: false, loading: true };
    historyPages.current.set(selectedChannelId, page);

    const backendChannel = backendChannelFor(selectedServerId, selectedChannelId);
    window.irc.getHistory(selectedServerId, backendChannel, undefined, HISTORY_PAGE_SIZE).then((entries) => {
      page.loading = false;
      page.exhausted = entries.length < HISTORY_PAGE_SIZE;
      page.oldestId = entries[0]?.id ?? null;
      const messages = toMessages(entries);
      if (messages.length > 0) setHistory(selectedChannelId, messages);
    });
  }, [selectedServerId, selectedChannelId, channelMap, setHistory]);

  // Scroll-up-to-load-older, wired into MessageArea's onScroll. Paged
  // backwards via the oldest row id we've fetched so far for this channel;
  // a no-op while a page is already in flight or we've hit the beginning.
  const loadOlderHistory = useCallback(() => {
    const page = historyPages.current.get(selectedChannelId);
    if (!selectedServerId || !page || page.loading || page.exhausted || page.oldestId === null) return;
    page.loading = true;

    const backendChannel = backendChannelFor(selectedServerId, selectedChannelId);
    window.irc.getHistory(selectedServerId, backendChannel, page.oldestId, HISTORY_PAGE_SIZE).then((entries) => {
      page.loading = false;
      page.exhausted = entries.length < HISTORY_PAGE_SIZE;
      if (entries[0]) page.oldestId = entries[0].id;
      const messages = toMessages(entries);
      if (messages.length > 0) setHistory(selectedChannelId, messages);
    });
  }, [selectedServerId, selectedChannelId, channelMap, setHistory]);

  async function handleConnect(form: ConnectForm) {
    const id = buildServerId(form.host, form.port);
    const { host, port } = parseServerId(id);
    addServer(
      { id, name: form.name, initial: form.name[0]?.toUpperCase() ?? '?', secure: form.secure },
      { id: `${id}:__log__`, name: 'Log', isLog: true },
    );
    addPreset({ id, name: form.name, host, port, secure: form.secure });
    setNick(id, form.nick);
    setSaslCreds(id, form.saslUser, form.saslPass);
    setConnectionStatus(id, 'connecting');
    await window.irc.connect(id, host, port, form.nick, form.secure, form.saslUser, form.saslPass);
    setConnectionStatus(id, 'connected');
    selectServer(id);
    setShowModal(false);
  }

  async function connectToServer() {
    const server = servers.find((s) => s.id === selectedServerId);
    if (!server) return;
    const { host, port } = parseServerId(server.id);
    const nick = nickMap[server.id] ?? 'dolq_user';
    const sasl = saslMap[server.id];
    setConnectionStatus(server.id, 'connecting');
    await window.irc.connect(server.id, host, port, nick, server.secure, sasl?.user, sasl?.pass);
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

  function handleOpenQuery(nick: string) {
    ensureQuery(selectedServerId, nick);
    selectChannel(nick);
  }

  const channels = channelMap[selectedServerId] ?? [];
  const selectedChannel = channels.find((c) => c.id === selectedChannelId) ?? channels[0];
  const messages = messageMap[selectedChannelId] ?? [];
  const users = userMap[selectedChannelId] ?? [];
  const isLog = selectedChannel?.isLog ?? true;
  const isQuery = selectedChannel?.isQuery ?? false;
  const currentNick = nickMap[selectedServerId] ?? 'dolq_user';
  const connectionStatus = statusMap[selectedServerId] ?? 'disconnected';

  async function handleSend(text: string): Promise<void> {
    const joinMatch = text.match(/^\/join\s+(#\S+)$/);
    const meMatch = text.match(/^\/me\s+(.+)$/);
    const msgMatch = text.match(/^\/msg\s+(\S+)\s+(.+)$/);

    if (text === '/connect') {
      if (connectionStatus === 'disconnected') connectToServer();
    } else if (text === '/disconnect') {
      handleDisconnect();
    } else if (joinMatch) {
      await window.irc.sendLine(selectedServerId, `JOIN ${joinMatch[1]}`);
    } else if (msgMatch) {
      const [, nick, msg] = msgMatch;
      await window.irc.sendLine(selectedServerId, `PRIVMSG ${nick} :${msg}`);
      handleOpenQuery(nick);
      appendMessage(nick, { id: nextMsgId.current++, nick: currentNick, text: msg, timestamp: new Date() });
    } else if (selectedChannel?.isLog) {
      await window.irc.sendLine(selectedServerId, text);
    } else if (meMatch) {
      const action = meMatch[1];
      await window.irc.sendLine(selectedServerId, `PRIVMSG ${selectedChannelId} :\x01ACTION ${action}\x01`);
      appendMessage(selectedChannelId, {
        id: nextMsgId.current++, nick: currentNick, text: action, timestamp: new Date(), action: true,
      });
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
            onCloseQuery={handleRemoveChannel}
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
      <main className="flex flex-col flex-1 bg-[#212121] overflow-hidden">
        <TopicBar
          channelName={selectedChannel?.name ?? ''}
          topic={selectedChannel?.topic}
          topicSetBy={selectedChannel?.topicSetBy}
          topicSetAt={selectedChannel?.topicSetAt}
          isLog={isLog}
          isQuery={isQuery}
        />
        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-col flex-1 overflow-hidden">
            <MessageArea messages={messages} isLog={isLog} channelId={selectedChannelId} onLoadOlder={loadOlderHistory} />
            <MessageInput
              channelName={selectedChannel?.name ?? ''}
              isLog={isLog}
              isQuery={isQuery}
              onSend={handleSend}
            />
          </div>
          <aside className="w-52 bg-[#1c1c1c] border-l border-[#2a2a2a] shrink-0 flex flex-col overflow-hidden">
            {!isLog && !isQuery && (
              <UserList users={users} currentNick={currentNick} onOpenQuery={handleOpenQuery} />
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
