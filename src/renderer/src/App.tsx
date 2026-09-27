import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryEntry, IrcEvent, Settings } from '../../shared/ipc';
import { ChannelList } from './components/ChannelList';
import { ConnectionStatus } from './components/ConnectionStatus';
import { type ConnectForm, ConnectModal, parseList } from './components/ConnectModal';
import { DCCOfferModal } from './components/DCCOfferModal';
import { type EditServerForm, EditServerModal } from './components/EditServerModal';
import { MessageArea } from './components/MessageArea';
import { MessageInput } from './components/MessageInput';
import { NickServIdentifyModal } from './components/NickServIdentifyModal';
import { PreferencesModal } from './components/PreferencesModal';
import { SearchModal } from './components/SearchModal';
import { ServerList } from './components/ServerList';
import { TopicBar } from './components/TopicBar';
import { type Transfer, TransferStatus } from './components/TransferStatus';
import { UserList } from './components/UserList';
import { UserPanel } from './components/UserPanel';
import { WhoisModal } from './components/WhoisModal';
import { XDCCOfferModal } from './components/XDCCOfferModal';
import { scopeKey, useStore } from './store';
import type { Message, Server } from './types';
import { expandAlias } from './utils/aliases';
import { formatEntry } from './utils/exportFormat';
import { comboFromEvent } from './utils/keybind';
import { mentionsNick } from './utils/mentions';
import { isNickServIdentifyPrompt } from './utils/nickserv';
import { buildServerId, normalizeHost, resolveHostPort } from './utils/server';

const HISTORY_PAGE_SIZE = 100;

const MAX_ALIAS_DEPTH = 8;

const FONT_SIZE_ZOOM: Record<'small' | 'medium' | 'large', number> = {
  small: 0.9,
  medium: 1,
  large: 1.15,
};

const FONT_FAMILY_STACKS: Record<'system' | 'serif' | 'monospace', string> = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  serif: "Georgia, 'Times New Roman', Times, serif",
  monospace: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
};

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
    } else if (e.event?.type === 'XDCCPACK') {
      const p = e.event;
      messages.push({
        id: e.id,
        nick: p.nick,
        timestamp,
        xdccPack: true,
        xdccPackNumber: p.number,
        text: `#${p.number} · ${p.gets}x sent · ${p.size} · ${p.filename}`,
      });
    }
  }
  return messages;
}

type HistoryPage = { oldestId: number | null; exhausted: boolean; loading: boolean };

type MainView =
  | { kind: 'chat' }
  | { kind: 'connect' }
  | { kind: 'preferences' }
  | { kind: 'editServer'; serverId: string };

function notify(title: string, body: string, onClick: () => void): void {
  if (typeof Notification === 'undefined') return;
  const n = new Notification(title, { body });
  n.onclick = onClick;
}

export default function App() {
  const {
    servers,
    presets,
    channelMap,
    messageMap,
    userMap,
    nickMap,
    saslMap,
    selectedServerId,
    selectedChannelId,
    statusMap,
    mentionedChannels,
    lastReadMap,
    notificationsEnabled,
    soundAlertsEnabled,
    mutedChannels,
    timestampFormat,
    messageDensity,
    fontSize,
    fontFamily,
    theme,
    ignoredNicks,
    selfAwayMap,
    aliases,
    keybindings,
    addServer,
    removeServer,
    addPreset,
    addChannel,
    removeChannel,
    setChannelJoined,
    setTopic,
    setTopicWhoTime,
    appendMessage,
    setHistory,
    setNick,
    setSaslCreds,
    selectServer,
    selectChannel,
    setConnectionStatus,
    setUsers,
    addUser,
    removeUser,
    removeUserEverywhere,
    renameUserEverywhere,
    applyModeChanges,
    markMentioned,
    markRead,
    toggleMuteChannel,
    setNotificationsEnabled,
    setSoundAlertsEnabled,
    setTimestampFormat,
    setMessageDensity,
    setFontSize,
    setFontFamily,
    setTheme,
    addIgnore,
    removeIgnore,
    applyAwayEverywhere,
    setSelfAway,
    setAlias,
    removeAlias,
    setKeybinding,
    setServerColor,
    updateServer,
  } = useStore();

  const [view, setView] = useState<MainView>({ kind: 'chat' });
  const [connectPrefill, setConnectPrefill] = useState<{
    host: string;
    port: number;
    secure: boolean;
    channel?: string;
  } | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [settings, setSettingsState] = useState<Settings>({ retentionDays: 0 });
  const [whoisNick, setWhoisNick] = useState<string | null>(null);
  const [whoisResult, setWhoisResult] = useState<Extract<IrcEvent, { type: 'whois' }> | null>(null);
  const [pendingDCCOffer, setPendingDCCOffer] = useState<{
    serverId: string;
    nick: string;
    ip: string;
    port: number;
  } | null>(null);
  const [pendingXDCCOffer, setPendingXDCCOffer] = useState<{
    serverId: string;
    nick: string;
    filename: string;
    ip: string;
    port: number;
    size: number;
    token?: string;
  } | null>(null);
  const [transfers, setTransfers] = useState<Record<string, Transfer & { serverId: string; path: string }>>({});
  const transferSpeedTrack = useRef<Record<string, { received: number; at: number }>>({});
  const [pendingIdentifyServerId, setPendingIdentifyServerId] = useState<string | null>(null);
  const nextMsgId = useRef(Date.now());
  const historyPages = useRef(new Map<string, HistoryPage>());

  useEffect(() => {
    window.irc.getSettings().then(setSettingsState);
  }, []);

  useEffect(() => {
    window.irc.setBadgeCount(Object.keys(mentionedChannels).length);
  }, [mentionedChannels]);

  useEffect(() => {
    window.irc.setZoomFactor(FONT_SIZE_ZOOM[fontSize]);
  }, [fontSize]);

  useEffect(() => {
    document.documentElement.style.setProperty('--dolq-font-family', FONT_FAMILY_STACKS[fontFamily]);
  }, [fontFamily]);

  useEffect(() => {
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
  }, [theme]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const combo = comboFromEvent(e);
      if (!combo) return;
      const action = (Object.keys(keybindings) as (keyof typeof keybindings)[]).find((a) => keybindings[a] === combo);
      if (!action) return;
      const list = channelMap[selectedServerId] ?? [];
      if (list.length === 0) return;
      e.preventDefault();
      switch (action) {
        case 'nextChannel':
        case 'prevChannel': {
          const dir = action === 'nextChannel' ? 1 : -1;
          const idx = list.findIndex((c) => c.id === selectedChannelId);
          handleSelectChannel(list[(idx + dir + list.length) % list.length].id);
          break;
        }
        case 'closeChannel': {
          const current = list.find((c) => c.id === selectedChannelId);
          if (current && !current.isLog) handleRemoveChannel(current.id);
          break;
        }
        case 'toggleMute':
          toggleMuteChannel(selectedChannelId);
          break;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    keybindings,
    channelMap,
    selectedServerId,
    selectedChannelId,
    toggleMuteChannel,
    handleSelectChannel,
    handleRemoveChannel,
  ]);

  async function handleSavePreferences(next: Settings) {
    await window.irc.setSettings(next);
    setSettingsState(next);
    setView({ kind: 'chat' });
  }

  function handleSelectServer(id: string) {
    setView({ kind: 'chat' });
    selectServer(id);
  }

  function handleSelectChannel(id: string) {
    setView({ kind: 'chat' });
    markRead(scopeKey(useStore.getState().selectedServerId, id));
    selectChannel(id);
  }

  function backendChannelFor(serverId: string, channelId: string): string {
    const channel = channelMap[serverId]?.find((c) => c.id === channelId);
    return channel?.isLog ? '__log__' : channelId;
  }

  function presetNickMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const s of servers) {
      if (!s.host || !s.port) continue;
      const nick = nickMap[s.id];
      if (nick) map[buildServerId(s.host, s.port)] = nick;
    }
    return map;
  }

  useEffect(() => {
    return window.irc.onStatus((serverId, status) => setConnectionStatus(serverId, status));
  }, [setConnectionStatus]);

  useEffect(() => {
    return window.irc.onOpenIrcUrl((prefill) => {
      setConnectPrefill(prefill);
      setView({ kind: 'connect' });
    });
  }, []);

  useEffect(() => {
    return window.irc.onOpenPreferences(() => setView({ kind: 'preferences' }));
  }, []);

  useEffect(() => {
    async function reconcile() {
      const { servers, channelMap } = useStore.getState();
      for (const s of servers) {
        const status = await window.irc.getStatus(s.id);
        setConnectionStatus(s.id, status);

        if (status === 'connected') {
          const joined = new Set(await window.irc.getJoinedChannels(s.id));
          (channelMap[s.id] ?? []).forEach((ch) => {
            if (ch.isLog || ch.isQuery) return;
            if (joined.has(ch.id)) window.irc.sendLine(s.id, `NAMES ${ch.id}`);
            else setChannelJoined(s.id, ch.id, false);
          });
          continue;
        }

        try {
          await connectServer(s);
        } catch {
          setConnectionStatus(s.id, 'disconnected');
        }
      }
    }
    if (useStore.persist.hasHydrated()) {
      reconcile();
      return;
    }
    return useStore.persist.onFinishHydration(reconcile);
  }, [setConnectionStatus, setChannelJoined, connectServer]);

  function dccPeerNick(dccId: string): string {
    for (const channels of Object.values(channelMap)) {
      const ch = channels.find((c) => c.id === dccId);
      if (ch) return ch.name;
    }
    return '';
  }

  useEffect(() => {
    return window.irc.onLine((serverId, line) => {
      if (serverId.startsWith('dcc:')) {
        appendMessage(serverId, {
          id: nextMsgId.current++,
          nick: dccPeerNick(serverId),
          text: line,
          timestamp: new Date(),
        });
        return;
      }
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
  }, [appendMessage, dccPeerNick]);

  function ensureQuery(serverId: string, nick: string) {
    if (!(channelMap[serverId] ?? []).some((c) => c.id === nick)) {
      addChannel(serverId, { id: nick, name: nick, isLog: false, isQuery: true });
    }
  }

  function dmKey(serverId: string, target: string, nick: string): string {
    if (target.startsWith('#')) return target;
    ensureQuery(serverId, nick);
    return nick;
  }

  function checkMention(serverId: string, channelId: string, target: string, text: string) {
    if (!target.startsWith('#') || channelId === selectedChannelId || mutedChannels[channelId]) return;
    if (!mentionsNick(text, nickMap[serverId])) return;
    markMentioned(channelId);
    if (notificationsEnabled) {
      notify(`Mentioned in ${channelId}`, text, () => {
        handleSelectServer(serverId);
        handleSelectChannel(channelId);
      });
    }
    if (soundAlertsEnabled) window.irc.playAlertSound();
  }

  function isIgnored(serverId: string, nick: string): boolean {
    return (ignoredNicks[serverId] ?? []).includes(nick);
  }

  useEffect(() => {
    return window.irc.onEvent((serverId, event) => {
      switch (event.type) {
        case 'PRIVMSG': {
          if (isIgnored(serverId, event.nick)) break;
          const key = dmKey(serverId, event.target, event.nick);
          appendMessage(scopeKey(serverId, key), {
            id: nextMsgId.current++,
            nick: event.nick,
            text: event.text,
            timestamp: new Date(),
          });
          checkMention(serverId, key, event.target, event.text);
          break;
        }
        case 'ACTION': {
          if (isIgnored(serverId, event.nick)) break;
          const key = dmKey(serverId, event.target, event.nick);
          appendMessage(scopeKey(serverId, key), {
            id: nextMsgId.current++,
            nick: event.nick,
            text: event.text,
            timestamp: new Date(),
            action: true,
          });
          checkMention(serverId, key, event.target, event.text);
          break;
        }
        case 'NOTICE':
          if (event.target.startsWith('#') && !isIgnored(serverId, event.nick)) {
            appendMessage(scopeKey(serverId, event.target), {
              id: nextMsgId.current++,
              nick: event.nick,
              text: event.text,
              timestamp: new Date(),
              notice: true,
            });
          }
          if (isNickServIdentifyPrompt(event.nick, event.text)) {
            setPendingIdentifyServerId(serverId);
          }
          break;
        case 'XDCCPACK': {
          if (isIgnored(serverId, event.nick)) break;
          const key = dmKey(serverId, event.target, event.nick);
          appendMessage(scopeKey(serverId, key), {
            id: nextMsgId.current++,
            nick: event.nick,
            text: `#${event.number} · ${event.gets}x sent · ${event.size} · ${event.filename}`,
            timestamp: new Date(),
            xdccPack: true,
            xdccPackNumber: event.number,
          });
          break;
        }
        case 'JOIN':
          if (event.nick === nickMap[serverId]) {
            addChannel(serverId, { id: event.channel, name: event.channel.slice(1), isLog: false });
            setChannelJoined(serverId, event.channel, true);
            selectChannel(event.channel);
          } else {
            addUser(scopeKey(serverId, event.channel), { nick: event.nick, privileges: [] });
          }
          break;
        case 'PART':
          removeUser(scopeKey(serverId, event.channel), event.nick);
          if (event.nick === nickMap[serverId]) setChannelJoined(serverId, event.channel, false);
          break;
        case 'KICK':
          removeUser(scopeKey(serverId, event.channel), event.nick);
          if (event.nick === nickMap[serverId]) {
            setChannelJoined(serverId, event.channel, false);
            appendMessage(scopeKey(serverId, event.channel), {
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
          if (event.oldNick === nickMap[serverId]) setNick(serverId, event.newNick);
          break;
        case 'WELCOME':
          setNick(serverId, event.nick);
          servers
            .find((s) => s.id === serverId)
            ?.autojoinChannels?.forEach((ch) => {
              window.irc.sendLine(serverId, `JOIN ${ch}`);
            });
          break;
        case 'NICKINUSE': {
          const text = event.retrying
            ? `Nickname "${event.nick}" is already in use - trying "${event.retrying}" instead.`
            : `Nickname "${event.nick}" is already in use.`;
          appendMessage(`${serverId}:__log__`, {
            id: nextMsgId.current++,
            nick: '',
            text,
            timestamp: new Date(),
            system: true,
          });
          break;
        }
        case 'MODE':
          applyModeChanges(scopeKey(serverId, event.channel), event.changes);
          break;
        case 'names':
          setUsers(scopeKey(serverId, event.channel), event.users);
          break;
        case 'TOPIC':
          setTopic(serverId, event.channel, event.topic);
          if (event.nick) setTopicWhoTime(serverId, event.channel, event.nick, new Date());
          break;
        case 'TOPICWHOTIME':
          setTopicWhoTime(serverId, event.channel, event.nick, new Date(event.setAt * 1000));
          break;
        case 'whois':
          if (event.nick === whoisNick) setWhoisResult(event);
          break;
        case 'DCCCHATOFFER':
          setPendingDCCOffer({ serverId, nick: event.nick, ip: event.ip, port: event.port });
          break;
        case 'XDCCSENDOFFER':
          setPendingXDCCOffer({
            serverId,
            nick: event.nick,
            filename: event.filename,
            ip: event.ip,
            port: event.port,
            size: event.size,
            token: event.token,
          });
          break;
        case 'XDCCTRANSFER': {
          const id = serverId;
          if (event.done || event.error) {
            delete transferSpeedTrack.current[id];
            setTransfers((prev) => {
              const t = prev[id];
              if (!t) return prev;
              const text = event.error
                ? `Download of ${t.filename} failed: ${event.error}`
                : `Downloaded ${t.filename} to ${event.path}`;
              ensureQuery(t.serverId, t.nick);
              appendMessage(scopeKey(t.serverId, t.nick), {
                id: nextMsgId.current++,
                nick: '',
                text,
                timestamp: new Date(),
                system: true,
              });
              return {
                ...prev,
                [id]: {
                  ...t,
                  received: event.received,
                  total: event.total,
                  path: event.path,
                  done: event.done,
                  error: event.error,
                },
              };
            });
            break;
          }
          const now = Date.now();
          const prevTrack = transferSpeedTrack.current[id];
          const dt = prevTrack ? (now - prevTrack.at) / 1000 : 0;
          const speedBps = dt > 0 ? (event.received - prevTrack.received) / dt : undefined;
          transferSpeedTrack.current[id] = { received: event.received, at: now };
          setTransfers((prev) => {
            const t = prev[id];
            if (!t) return prev;
            return {
              ...prev,
              [id]: { ...t, received: event.received, total: event.total, speedBps: speedBps ?? t.speedBps },
            };
          });
          break;
        }
        case 'AWAY':
          applyAwayEverywhere(event.nick, event.away);
          break;
        case 'SELFAWAY':
          setSelfAway(serverId, event.away);
          break;
      }
    });
  }, [
    appendMessage,
    addChannel,
    selectChannel,
    addUser,
    removeUser,
    removeUserEverywhere,
    renameUserEverywhere,
    applyModeChanges,
    setUsers,
    setTopic,
    setTopicWhoTime,
    nickMap,
    setNick,
    servers,
    whoisNick,
    applyAwayEverywhere,
    setSelfAway,
    isIgnored,
    dmKey,
    ensureQuery,
    setChannelJoined,
    checkMention,
  ]);

  useEffect(() => {
    if (!selectedServerId) return;
    const key = scopeKey(selectedServerId, selectedChannelId);
    if (historyPages.current.has(key)) return;
    const page: HistoryPage = { oldestId: null, exhausted: false, loading: true };
    historyPages.current.set(key, page);

    const backendChannel = backendChannelFor(selectedServerId, selectedChannelId);
    window.irc.getHistory(selectedServerId, backendChannel, undefined, HISTORY_PAGE_SIZE).then((entries) => {
      page.loading = false;
      page.exhausted = entries.length < HISTORY_PAGE_SIZE;
      page.oldestId = entries[0]?.id ?? null;
      const messages = toMessages(entries);
      if (messages.length > 0) setHistory(key, messages);
    });
  }, [selectedServerId, selectedChannelId, setHistory, backendChannelFor]);

  const loadOlderHistory = useCallback(() => {
    const key = scopeKey(selectedServerId, selectedChannelId);
    const page = historyPages.current.get(key);
    if (!selectedServerId || !page || page.loading || page.exhausted || page.oldestId === null) return;
    page.loading = true;

    const backendChannel = backendChannelFor(selectedServerId, selectedChannelId);
    window.irc.getHistory(selectedServerId, backendChannel, page.oldestId, HISTORY_PAGE_SIZE).then((entries) => {
      page.loading = false;
      page.exhausted = entries.length < HISTORY_PAGE_SIZE;
      if (entries[0]) page.oldestId = entries[0].id;
      const messages = toMessages(entries);
      if (messages.length > 0) setHistory(key, messages);
    });
  }, [selectedServerId, selectedChannelId, setHistory, backendChannelFor]);

  async function handleConnect(form: ConnectForm) {
    const id = crypto.randomUUID();
    const host = normalizeHost(form.host);
    const port = Number(form.port);
    const altNicks = parseList(form.altNicks);
    const autojoinChannels = parseList(form.autojoinChannels);
    const name = form.name.trim() || host;
    addServer(
      {
        id,
        name,
        initial: name[0]?.toUpperCase() ?? '?',
        secure: form.secure,
        host,
        port,
        altNicks,
        username: form.username || undefined,
        realname: form.realname || undefined,
        autojoinChannels,
      },
      { id: `${id}:__log__`, name: 'Log', isLog: true },
    );
    addPreset({ id: buildServerId(host, port), name, host, port, secure: form.secure });
    setNick(id, form.nick);
    setSaslCreds(id, form.saslUser, form.saslPass);
    setConnectionStatus(id, 'connecting');
    await window.irc.connect(
      id,
      host,
      port,
      form.nick,
      form.secure,
      form.saslUser,
      form.saslPass,
      form.username,
      form.realname,
      altNicks,
    );
    setConnectionStatus(id, 'connected');
    handleSelectServer(id);
    setConnectPrefill(null);
  }

  function handleEditServer(id: string, form: EditServerForm) {
    const host = normalizeHost(form.host);
    const port = Number(form.port);
    const altNicks = parseList(form.altNicks);
    const autojoinChannels = parseList(form.autojoinChannels);
    const name = form.name.trim() || host;
    updateServer(id, {
      name,
      initial: name[0]?.toUpperCase() ?? '?',
      host,
      port,
      secure: form.secure,
      altNicks,
      username: form.username || undefined,
      realname: form.realname || undefined,
      autojoinChannels,
    });
    setNick(id, form.nick);
    setSaslCreds(id, form.saslUser, form.saslPass);
    setView({ kind: 'chat' });
  }

  async function connectServer(server: Server) {
    const { host, port } = resolveHostPort(server);
    const { nickMap, saslMap } = useStore.getState();
    const nick = nickMap[server.id] ?? 'dolq_user';
    const sasl = saslMap[server.id];
    setConnectionStatus(server.id, 'connecting');
    await window.irc.connect(
      server.id,
      host,
      port,
      nick,
      server.secure,
      sasl?.user,
      sasl?.pass,
      server.username,
      server.realname,
      server.altNicks,
    );
    setConnectionStatus(server.id, 'connected');
  }

  async function connectToServer() {
    const server = servers.find((s) => s.id === selectedServerId);
    if (!server) return;
    await connectServer(server);
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
    const channel = (channelMap[selectedServerId] ?? []).find((c) => c.id === channelId);
    if (channel?.isDCC) {
      await window.irc.dccClose(channelId);
    } else {
      if (channel && !channel.isQuery && channel.joined !== false) {
        await window.irc.sendLine(selectedServerId, `PART ${channelId}`);
      }
    }
    removeChannel(selectedServerId, channelId);
  }

  function handleOpenQuery(nick: string) {
    ensureQuery(selectedServerId, nick);
    handleSelectChannel(nick);
  }

  function handleWhois(nick: string) {
    setWhoisNick(nick);
    setWhoisResult(null);
    window.irc.sendLine(selectedServerId, `WHOIS ${nick}`);
  }

  function handleToggleIgnore(nick: string) {
    if (isIgnored(selectedServerId, nick)) {
      removeIgnore(selectedServerId, nick);
    } else {
      addIgnore(selectedServerId, nick);
    }
  }

  async function handleDCCOffer(nick: string) {
    const id = await window.irc.dccOffer(selectedServerId, nick);
    addChannel(selectedServerId, { id, name: nick, isLog: false, isQuery: true, isDCC: true });
    handleSelectChannel(id);
  }

  async function handleAcceptDCCOffer() {
    if (!pendingDCCOffer) return;
    const { serverId, nick, ip, port } = pendingDCCOffer;
    setPendingDCCOffer(null);
    const id = await window.irc.dccAccept(ip, port);
    addChannel(serverId, { id, name: nick, isLog: false, isQuery: true, isDCC: true });
    handleSelectServer(serverId);
    handleSelectChannel(id);
  }

  function handleDeclineDCCOffer() {
    setPendingDCCOffer(null);
  }

  function handleGetPack(nick: string, packNumber: number) {
    window.irc.sendLine(selectedServerId, `PRIVMSG ${nick} :XDCC SEND #${packNumber}`);
  }

  function handleGetPackFrom(serverId: string, nick: string, packNumber: number) {
    ensureQuery(serverId, nick);
    handleSelectServer(serverId);
    handleSelectChannel(nick);
    window.irc.sendLine(serverId, `PRIVMSG ${nick} :XDCC SEND #${packNumber}`);
    setShowSearch(false);
  }

  async function handleAcceptXDCCOffer() {
    if (!pendingXDCCOffer) return;
    const { serverId, nick, filename, ip, port, size, token } = pendingXDCCOffer;
    setPendingXDCCOffer(null);
    const id = await window.irc.xdccAccept(serverId, nick, ip, port, filename, size, token);
    setTransfers((prev) => ({ ...prev, [id]: { serverId, nick, filename, received: 0, total: size, path: '' } }));
  }

  function handleDeclineXDCCOffer() {
    setPendingXDCCOffer(null);
  }

  function handleCancelTransfer(id: string) {
    window.irc.xdccClose(id);
    delete transferSpeedTrack.current[id];
    setTransfers((prev) => {
      const { [id]: _cancelled, ...rest } = prev;
      return rest;
    });
  }

  function handleDismissTransfer(id: string) {
    setTransfers((prev) => {
      const { [id]: _dismissed, ...rest } = prev;
      return rest;
    });
  }

  function handlePauseTransfer(id: string) {
    window.irc.xdccPause(id);
    setTransfers((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], paused: true } } : prev));
  }

  function handleResumeTransfer(id: string) {
    window.irc.xdccResume(id);
    setTransfers((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], paused: false } } : prev));
  }

  function handleIdentify(password: string) {
    if (!pendingIdentifyServerId) return;
    window.irc.sendLine(pendingIdentifyServerId, `PRIVMSG NickServ :identify ${password}`);
    setPendingIdentifyServerId(null);
  }

  function handleJumpToSearchResult(serverId: string, channel: string) {
    handleSelectServer(serverId);
    if (channel === '__log__') {
      const logCh = (channelMap[serverId] ?? []).find((c) => c.isLog);
      handleSelectChannel(logCh?.id ?? '__log__');
    } else {
      handleSelectChannel(channel);
    }
    setShowSearch(false);
  }

  async function handleExportChannel(format: 'text' | 'json') {
    const backendChannel = backendChannelFor(selectedServerId, selectedChannelId);
    const pageSize = 1000;
    let all: HistoryEntry[] = [];
    let before: number | undefined;
    for (;;) {
      const page = await window.irc.getHistory(selectedServerId, backendChannel, before, pageSize);
      if (page.length === 0) break;
      all = [...page, ...all];
      before = page[0].id;
      if (page.length < pageSize) break;
    }

    const name = selectedChannel?.name || 'log';
    const content = format === 'json' ? JSON.stringify(all, null, 2) : all.map(formatEntry).join('\n');
    await window.irc.saveTextFile(`${name}.${format === 'json' ? 'json' : 'txt'}`, content);
  }

  const selectedServer = servers.find((s) => s.id === selectedServerId);
  const channels = channelMap[selectedServerId] ?? [];

  const awayStats = useMemo(() => {
    const stats: Record<string, { count: number; people: number }> = {};
    for (const ch of channels) {
      if (ch.isLog) continue;
      const key = scopeKey(selectedServerId, ch.id);
      const since = lastReadMap[key] ?? 0;
      const nicks = new Set<string>();
      let count = 0;
      for (const msg of messageMap[key] ?? []) {
        if (msg.system || msg.timestamp.getTime() <= since) continue;
        count++;
        if (msg.nick) nicks.add(msg.nick);
      }
      if (count > 0) stats[ch.id] = { count, people: nicks.size };
    }
    return stats;
  }, [channels, messageMap, lastReadMap, selectedServerId]);

  const selectedChannel = channels.find((c) => c.id === selectedChannelId) ?? channels[0];
  const messages = messageMap[scopeKey(selectedServerId, selectedChannelId)] ?? [];
  const users = userMap[scopeKey(selectedServerId, selectedChannelId)] ?? [];
  const isLog = selectedChannel?.isLog ?? true;
  const isQuery = selectedChannel?.isQuery ?? false;
  const currentNick = nickMap[selectedServerId] ?? 'dolq_user';
  const connectionStatus = statusMap[selectedServerId] ?? 'disconnected';

  async function handleSend(text: string, aliasDepth = 0): Promise<void> {
    const joinMatch = text.match(/^\/join\s+(#\S+)(?:\s+(\S+))?$/);
    const meMatch = text.match(/^\/me\s+(.+)$/);
    const msgMatch = text.match(/^\/msg\s+(\S+)\s+(.+)$/);
    const awayMatch = text.match(/^\/away(?:\s+(.+))?$/);
    const aliasDefMatch = text.match(/^\/alias\s+(\S+)\s+(.+)$/);
    const unaliasMatch = text.match(/^\/unalias\s+(\S+)$/);
    const aliasInvokeMatch = text.match(/^\/(\S+)(?:\s+(.*))?$/);
    const aliasName = aliasInvokeMatch?.[1].toLowerCase();

    if (text === '/connect') {
      if (connectionStatus === 'disconnected') connectToServer();
    } else if (text === '/disconnect') {
      handleDisconnect();
    } else if (joinMatch) {
      const [, channel, key] = joinMatch;
      await window.irc.sendLine(selectedServerId, key ? `JOIN ${channel} ${key}` : `JOIN ${channel}`);
    } else if (awayMatch) {
      await window.irc.sendLine(selectedServerId, awayMatch[1] ? `AWAY :${awayMatch[1]}` : 'AWAY');
    } else if (msgMatch) {
      const [, nick, msg] = msgMatch;
      await window.irc.sendLine(selectedServerId, `PRIVMSG ${nick} :${msg}`);
      handleOpenQuery(nick);
      appendMessage(scopeKey(selectedServerId, nick), {
        id: nextMsgId.current++,
        nick: currentNick,
        text: msg,
        timestamp: new Date(),
      });
    } else if (aliasDefMatch) {
      setAlias(aliasDefMatch[1].toLowerCase(), aliasDefMatch[2]);
    } else if (unaliasMatch) {
      removeAlias(unaliasMatch[1].toLowerCase());
    } else if (aliasName && aliases[aliasName]) {
      if (aliasDepth >= MAX_ALIAS_DEPTH) {
        console.warn(`alias expansion too deep, stopping at "/${aliasName}"`);
        return;
      }
      await handleSend(expandAlias(aliases[aliasName], aliasInvokeMatch?.[2] ?? ''), aliasDepth + 1);
    } else if (selectedChannel?.isLog) {
      await window.irc.sendLine(selectedServerId, text);
    } else if (selectedChannel?.isDCC) {
      await window.irc.dccSend(selectedChannelId, text);
      appendMessage(scopeKey(selectedServerId, selectedChannelId), {
        id: nextMsgId.current++,
        nick: currentNick,
        text,
        timestamp: new Date(),
      });
    } else if (meMatch) {
      const action = meMatch[1];
      await window.irc.sendLine(selectedServerId, `PRIVMSG ${selectedChannelId} :\x01ACTION ${action}\x01`);
      appendMessage(scopeKey(selectedServerId, selectedChannelId), {
        id: nextMsgId.current++,
        nick: currentNick,
        text: action,
        timestamp: new Date(),
        action: true,
      });
    } else {
      await window.irc.sendLine(selectedServerId, `PRIVMSG ${selectedChannelId} :${text}`);
      appendMessage(scopeKey(selectedServerId, selectedChannelId), {
        id: nextMsgId.current++,
        nick: currentNick,
        text,
        timestamp: new Date(),
      });
    }
  }

  return (
    <div className="flex w-full h-screen overflow-hidden">
      {whoisNick && (
        <WhoisModal
          nick={whoisNick}
          result={whoisResult}
          onClose={() => {
            setWhoisNick(null);
            setWhoisResult(null);
          }}
        />
      )}
      {pendingDCCOffer && (
        <DCCOfferModal nick={pendingDCCOffer.nick} onAccept={handleAcceptDCCOffer} onDecline={handleDeclineDCCOffer} />
      )}
      {pendingXDCCOffer && (
        <XDCCOfferModal
          nick={pendingXDCCOffer.nick}
          filename={pendingXDCCOffer.filename}
          size={pendingXDCCOffer.size}
          onAccept={handleAcceptXDCCOffer}
          onDecline={handleDeclineXDCCOffer}
        />
      )}
      <TransferStatus
        transfers={transfers}
        onPause={handlePauseTransfer}
        onResume={handleResumeTransfer}
        onCancel={handleCancelTransfer}
        onDismiss={handleDismissTransfer}
      />
      {showSearch && (
        <SearchModal
          servers={servers}
          defaultServerId={selectedServerId}
          defaultChannel={backendChannelFor(selectedServerId, selectedChannelId)}
          defaultChannelLabel={
            isLog ? 'Log' : isQuery ? (selectedChannel?.name ?? '') : `#${selectedChannel?.name ?? ''}`
          }
          onJump={handleJumpToSearchResult}
          onGetPack={handleGetPackFrom}
          onClose={() => setShowSearch(false)}
        />
      )}
      {pendingIdentifyServerId && (
        <NickServIdentifyModal onIdentify={handleIdentify} onDismiss={() => setPendingIdentifyServerId(null)} />
      )}
      <div className="relative flex flex-col shrink-0">
        <div className="flex flex-1 overflow-hidden">
          <ServerList
            servers={servers}
            selectedId={selectedServerId}
            onSelect={handleSelectServer}
            onAddServer={() => setView({ kind: 'connect' })}
            onRemove={handleRemoveServer}
            onChangeColor={setServerColor}
            onEditServer={(id) => setView({ kind: 'editServer', serverId: id })}
          />
          <ChannelList
            serverName={selectedServer?.name ?? ''}
            channels={channels}
            selectedId={selectedChannelId}
            onSelect={handleSelectChannel}
            mentionedChannels={mentionedChannels}
            awayStats={awayStats}
            mutedChannels={mutedChannels}
            onToggleMuteChannel={toggleMuteChannel}
            onJoinChannel={handleJoinChannel}
            onLeaveChannel={handleLeaveChannel}
            onRemoveChannel={handleRemoveChannel}
            onCloseQuery={handleRemoveChannel}
            onOpenSearch={() => setShowSearch(true)}
          />
        </div>
        <div className="absolute bottom-0 left-0 w-full px-3 pt-2 pb-2">
          <UserPanel
            currentNick={currentNick}
            away={selfAwayMap[selectedServerId] ?? false}
            onOpenPreferences={() => setView({ kind: 'preferences' })}
          />
        </div>
      </div>
      <main className="flex flex-col flex-1 bg-(--dolq-bg) overflow-hidden">
        {view.kind === 'connect' ? (
          <ConnectModal
            key={connectPrefill ? `${connectPrefill.host}:${connectPrefill.port}` : 'blank'}
            presets={presets}
            nickMap={presetNickMap()}
            onConnect={handleConnect}
            onCancel={() => {
              setView({ kind: 'chat' });
              setConnectPrefill(null);
            }}
            initial={connectPrefill ?? undefined}
          />
        ) : view.kind === 'editServer' ? (
          (() => {
            const server = servers.find((s) => s.id === view.serverId);
            if (!server) return null;
            const sasl = saslMap[view.serverId];
            return (
              <EditServerModal
                key={server.id}
                server={server}
                nick={nickMap[view.serverId] ?? ''}
                saslUser={sasl?.user ?? ''}
                saslPass={sasl?.pass ?? ''}
                onSave={handleEditServer}
                onCancel={() => setView({ kind: 'chat' })}
              />
            );
          })()
        ) : view.kind === 'preferences' ? (
          <PreferencesModal
            settings={settings}
            onSave={handleSavePreferences}
            onCancel={() => setView({ kind: 'chat' })}
            notificationsEnabled={notificationsEnabled}
            onNotificationsEnabledChange={setNotificationsEnabled}
            soundAlertsEnabled={soundAlertsEnabled}
            onSoundAlertsEnabledChange={setSoundAlertsEnabled}
            timestampFormat={timestampFormat}
            onTimestampFormatChange={setTimestampFormat}
            messageDensity={messageDensity}
            onMessageDensityChange={setMessageDensity}
            fontSize={fontSize}
            onFontSizeChange={setFontSize}
            fontFamily={fontFamily}
            onFontFamilyChange={setFontFamily}
            theme={theme}
            onThemeChange={setTheme}
            servers={servers}
            ignoredNicks={ignoredNicks}
            onRemoveIgnore={removeIgnore}
            aliases={aliases}
            onRemoveAlias={removeAlias}
            keybindings={keybindings}
            onKeybindingChange={setKeybinding}
          />
        ) : (
          <div className="flex flex-1 overflow-hidden">
            <div className="flex flex-col flex-1 overflow-hidden">
              <TopicBar
                channelName={selectedChannel?.name ?? ''}
                topic={selectedChannel?.topic}
                topicSetBy={selectedChannel?.topicSetBy}
                topicSetAt={selectedChannel?.topicSetAt}
                isLog={isLog}
                isQuery={isQuery}
                isDCC={selectedChannel?.isDCC}
                dccStatus={selectedChannel?.isDCC ? statusMap[selectedChannelId] : undefined}
                onExport={selectedChannel?.isDCC ? undefined : handleExportChannel}
                serverColor={selectedServer?.color}
              />
              <MessageArea
                messages={messages}
                isLog={isLog}
                channelId={scopeKey(selectedServerId, selectedChannelId)}
                onLoadOlder={loadOlderHistory}
                timestampFormat={timestampFormat}
                density={messageDensity}
                onGetPack={handleGetPack}
              />
              <MessageInput
                channelName={selectedChannel?.name ?? ''}
                isLog={isLog}
                isQuery={isQuery}
                onSend={handleSend}
              />
            </div>
            <aside className="w-52 py-3 bg-(--dolq-bg-panel) border-l border-(--dolq-border) shrink-0 flex flex-col overflow-hidden relative">
              {!isLog && !isQuery && (
                <UserList
                  users={users}
                  currentNick={currentNick}
                  onOpenQuery={handleOpenQuery}
                  onWhois={handleWhois}
                  ignoredNicks={ignoredNicks[selectedServerId] ?? []}
                  onToggleIgnore={handleToggleIgnore}
                  onDCCOffer={handleDCCOffer}
                />
              )}
              <div className="absolute bottom-0 left-0 w-full px-3 pt-2 pb-2">
                <ConnectionStatus
                  connectionStatus={connectionStatus}
                  onConnect={connectToServer}
                  onDisconnect={handleDisconnect}
                />
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
