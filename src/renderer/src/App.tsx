import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryEntry, IrcEvent, Settings } from '../../shared/ipc';
import { ChannelList } from './components/ChannelList';
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
import { shouldAlert } from './utils/alerts';
import { expandAlias } from './utils/aliases';
import { parseSlashCommand } from './utils/commands';
import { attemptConnect } from './utils/connectAttempt';
import { describeEvent, eventChannels } from './utils/eventMessages';
import { formatEntry } from './utils/exportFormat';
import { canLoadOlder, dropServerPages, type HistoryPage, linesToStore, pagesToReload } from './utils/historyPages';
import { comboFromEvent } from './utils/keybind';
import { isChannelScopedLine } from './utils/logFilter';
import { mentionsNick } from './utils/mentions';
import { isNickServIdentifyPrompt } from './utils/nickserv';
import { reconcileServers, reconcileStep } from './utils/reconcile';
import { buildServerId, normalizeHost, resolveHostPort } from './utils/server';
import { computeAwayStats } from './utils/unread';
import { takeAutoAccept, xdccRequestKey, xdccRequestTarget, xdccSenderKey } from './utils/xdcc';

const HISTORY_PAGE_SIZE = 100;

const MAX_ALIAS_DEPTH = 8;

const FONT_SIZE_ZOOM: Record<'small' | 'medium' | 'large', number> = {
  small: 0.9,
  medium: 1,
  large: 1.15,
};

const FONT_FAMILY_STACKS: Record<'system' | 'serif' | 'monospace', string> = {
  system: "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  serif: "Georgia, 'Times New Roman', Times, serif",
  monospace: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
};

function toMessages(entries: HistoryEntry[], forLog: boolean, selfNick: string): Message[] {
  const messages: Message[] = [];
  for (const e of entries) {
    const timestamp = new Date(e.timestamp);
    if (forLog) {
      if (e.isRaw && !isChannelScopedLine(e.line ?? '')) {
        messages.push({ id: e.id, nick: '', text: e.line ?? '', timestamp, isRaw: true });
      }
      continue;
    }
    const described = e.event ? describeEvent(e.event, selfNick) : null;
    if (described) {
      messages.push({
        id: e.id,
        nick: '',
        text: described.text,
        timestamp,
        system: true,
        membership: described.membership,
      });
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

type PendingXDCCOffer = {
  serverId: string;
  nick: string;
  filename: string;
  ip: string;
  port: number;
  size: number;
  token?: string;
  host?: string;
  account?: string;
};

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
    showMembershipEvents,
    mutedChannels,
    timestampFormat,
    messageDensity,
    fontSize,
    fontFamily,
    theme,
    ignoredNicks,
    xdccTrusted,
    trustXdccSender,
    untrustXdccSender,
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
    clearMessages,
    setNick,
    setSaslCreds,
    setServerPassword,
    selectServer,
    selectChannel,
    selectChannelOnServer,
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
    setShowMembershipEvents,
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
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const requestedPacks = useRef(new Set<string>());
  const sessionTrusted = useRef(new Set<string>());
  const xdccTrustedRef = useRef(xdccTrusted);
  xdccTrustedRef.current = xdccTrusted;
  const [whoisNick, setWhoisNick] = useState<string | null>(null);
  const [whoisResult, setWhoisResult] = useState<Extract<IrcEvent, { type: 'whois' }> | null>(null);
  const [pendingDCCOffer, setPendingDCCOffer] = useState<{
    serverId: string;
    nick: string;
    ip: string;
    port: number;
  } | null>(null);
  const [pendingXDCCOffer, setPendingXDCCOffer] = useState<PendingXDCCOffer | null>(null);
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

  const handleSelectServer = useCallback(
    (id: string) => {
      setView({ kind: 'chat' });
      selectServer(id);
    },
    [selectServer],
  );

  const handleSelectChannel = useCallback(
    (id: string) => {
      setView({ kind: 'chat' });
      markRead(scopeKey(useStore.getState().selectedServerId, id));
      selectChannel(id);
    },
    [markRead, selectChannel],
  );

  const channelActions = useRef({ handleSelectChannel, handleRemoveChannel });
  channelActions.current = { handleSelectChannel, handleRemoveChannel };

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
          channelActions.current.handleSelectChannel(list[(idx + dir + list.length) % list.length].id);
          break;
        }
        case 'closeChannel': {
          const current = list.find((c) => c.id === selectedChannelId);
          if (current && !current.isLog) channelActions.current.handleRemoveChannel(current.id);
          break;
        }
        case 'toggleMute':
          toggleMuteChannel(selectedChannelId);
          break;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keybindings, channelMap, selectedServerId, selectedChannelId, toggleMuteChannel]);

  async function handleSavePreferences(next: Settings) {
    await window.irc.setSettings(next);
    setSettingsState(next);
    setView({ kind: 'chat' });
  }

  const backendChannelFor = useCallback(
    (serverId: string, channelId: string): string => {
      const channel = channelMap[serverId]?.find((c) => c.id === channelId);
      return channel?.isLog ? '__log__' : channelId;
    },
    [channelMap],
  );

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
    return window.irc.onStatus((serverId, status) => {
      if (status === 'disconnected') {
        for (const key of sessionTrusted.current) {
          if (key.startsWith(`${serverId}\0`)) sessionTrusted.current.delete(key);
        }
      }
      setConnectionStatus(serverId, status);
    });
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

  const logConnectFailure = useCallback(
    (serverId: string, message: string) =>
      appendMessage(`${serverId}:__log__`, {
        id: nextMsgId.current++,
        nick: '',
        text: `*** Could not connect: ${message}`,
        timestamp: new Date(),
        system: true,
      }),
    [appendMessage],
  );

  const connectServer = useCallback(
    async (server: Server) => {
      const { host, port } = resolveHostPort(server);
      const { nickMap, saslMap, passwordMap } = useStore.getState();
      const nick = nickMap[server.id] ?? 'dolq_user';
      const sasl = saslMap[server.id];
      const failure = await attemptConnect(server.id, setConnectionStatus, () =>
        window.irc.connect(
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
          passwordMap[server.id] || undefined,
        ),
      );
      if (failure) logConnectFailure(server.id, failure);
    },
    [setConnectionStatus, logConnectFailure],
  );

  // Brings statuses and joined channels in line with the backend, attaching to
  // its sessions (getStatus) and connecting the servers it has none for that are
  // set to connect on startup; the others stay disconnected. One it is still
  // reconnecting is left to finish; its rejoins arrive as JOIN events.
  // onAttached runs once every server is attached, before any sync or connect.
  const reconcile = useCallback(
    async (onAttached: () => void = () => {}) => {
      const { servers, channelMap } = useStore.getState();
      await reconcileServers(
        servers,
        async (s) => {
          const status = await window.irc.getStatus(s.id).catch(() => 'disconnected' as const);
          setConnectionStatus(s.id, status);
          return status;
        },
        onAttached,
        async (s, status) => {
          const step = reconcileStep(status, s);
          if (step === 'wait' || step === 'skip') return;

          if (step === 'sync') {
            const joined = new Set(await window.irc.getJoinedChannels(s.id).catch(() => [] as string[]));
            (channelMap[s.id] ?? []).forEach((ch) => {
              if (ch.isLog || ch.isQuery) return;
              setChannelJoined(s.id, ch.id, joined.has(ch.id));
              if (joined.has(ch.id)) window.irc.sendLine(s.id, `NAMES ${ch.id}`);
            });
            return;
          }

          try {
            await connectServer(s);
          } catch {
            setConnectionStatus(s.id, 'disconnected');
          }
        },
      );
    },
    [setConnectionStatus, setChannelJoined, connectServer],
  );

  useEffect(() => {
    if (useStore.persist.hasHydrated()) {
      reconcile();
      return;
    }
    return useStore.persist.onFinishHydration(() => reconcile());
  }, [reconcile]);

  const dccPeerNick = useCallback(
    (dccId: string): string => {
      for (const channels of Object.values(channelMap)) {
        const ch = channels.find((c) => c.id === dccId);
        if (ch) return ch.name;
      }
      return '';
    },
    [channelMap],
  );

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
      if (isChannelScopedLine(line)) return;
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

  const ensureQuery = useCallback(
    (serverId: string, nick: string) => {
      if (!(channelMap[serverId] ?? []).some((c) => c.id === nick)) {
        addChannel(serverId, { id: nick, name: nick, isLog: false, isQuery: true });
      }
    },
    [channelMap, addChannel],
  );

  const dmKey = useCallback(
    (serverId: string, target: string, nick: string): string => {
      if (target.startsWith('#')) return target;
      ensureQuery(serverId, nick);
      return nick;
    },
    [ensureQuery],
  );

  const checkMention = useCallback(
    (serverId: string, channelId: string, target: string, text: string) => {
      const { selectedServerId: onScreenServer } = useStore.getState();
      const alert = shouldAlert({
        target,
        channelId,
        selectedChannelId: onScreenServer === serverId ? selectedChannelId : '',
        muted: !!mutedChannels[channelId],
        windowFocused: document.hasFocus(),
        mentioned: mentionsNick(text, nickMap[serverId]),
      });
      if (!alert) return;
      // A channel already on screen needs no unread dot, only the alert.
      if (!(onScreenServer === serverId && channelId === selectedChannelId)) markMentioned(channelId);
      if (notificationsEnabled) {
        notify(target.startsWith('#') ? `Mentioned in ${channelId}` : `Message from ${channelId}`, text, () => {
          handleSelectServer(serverId);
          handleSelectChannel(channelId);
        });
      }
      if (soundAlertsEnabled) window.irc.playAlertSound();
    },
    [
      selectedChannelId,
      mutedChannels,
      nickMap,
      markMentioned,
      notificationsEnabled,
      soundAlertsEnabled,
      handleSelectServer,
      handleSelectChannel,
    ],
  );

  const startXDCCDownload = useCallback(async (offer: PendingXDCCOffer) => {
    const { serverId, nick, filename, ip, port, size, token } = offer;
    const id = await window.irc.xdccAccept(serverId, nick, ip, port, filename, size, token);
    setTransfers((prev) => ({ ...prev, [id]: { serverId, nick, filename, received: 0, total: size, path: '' } }));
  }, []);

  const isIgnored = useCallback(
    (serverId: string, nick: string): boolean => {
      return (ignoredNicks[serverId] ?? []).includes(nick);
    },
    [ignoredNicks],
  );

  useEffect(() => {
    return window.irc.onEvent((serverId, event) => {
      const described = describeEvent(event, nickMap[serverId] ?? '');
      if (described) {
        const actor = 'nick' in event ? event.nick : event.type === 'NICK' ? event.oldNick : '';
        if (!(described.membership && actor && isIgnored(serverId, actor))) {
          for (const channel of eventChannels(event)) {
            appendMessage(scopeKey(serverId, channel), {
              id: nextMsgId.current++,
              nick: '',
              text: described.text,
              timestamp: new Date(),
              system: true,
              membership: described.membership,
            });
          }
        }
      }
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
            selectChannelOnServer(serverId, event.channel);
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
          }
          break;
        case 'QUIT':
          removeUserEverywhere(serverId, event.nick);
          break;
        case 'NICK':
          renameUserEverywhere(serverId, event.oldNick, event.newNick);
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
        case 'XDCCSENDOFFER': {
          const offer = {
            serverId,
            nick: event.nick,
            filename: event.filename,
            ip: event.ip,
            port: event.port,
            size: event.size,
            token: event.token,
            host: event.host,
            account: event.account,
          };
          const senderKey = xdccSenderKey(offer);
          const trusted =
            senderKey !== '' &&
            (sessionTrusted.current.has(`${serverId}\0${senderKey}`) ||
              (xdccTrustedRef.current[serverId] ?? []).some((t) => xdccSenderKey(t) === senderKey));
          if (
            takeAutoAccept(!!settingsRef.current.xdccAutoAccept, trusted, requestedPacks.current, serverId, event.nick)
          ) {
            void startXDCCDownload(offer);
          } else {
            setPendingXDCCOffer(offer);
          }
          break;
        }
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
          applyAwayEverywhere(serverId, event.nick, event.away);
          break;
        case 'SELFAWAY':
          setSelfAway(serverId, event.away);
          break;
      }
    });
  }, [
    appendMessage,
    addChannel,
    selectChannelOnServer,
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
    startXDCCDownload,
    setChannelJoined,
    checkMention,
  ]);

  const fetchHistoryPage = useCallback(
    async (serverId: string, channelId: string, page: HistoryPage): Promise<Message[]> => {
      const backendChannel = backendChannelFor(serverId, channelId);
      const forLog = backendChannel === '__log__';
      const selfNick = nickMap[serverId] ?? '';
      const entries = await window.irc.getHistory(
        serverId,
        backendChannel,
        page.oldestId ?? undefined,
        HISTORY_PAGE_SIZE,
      );
      page.exhausted = entries.length < HISTORY_PAGE_SIZE;
      if (entries[0]) page.oldestId = entries[0].id;
      return toMessages(entries, forLog, selfNick);
    },
    [backendChannelFor, nickMap],
  );

  // A page replaced by reloadHistory while its fetch was under way is stale:
  // its results are dropped. A page with nothing to show is still set, so the
  // view re-renders and can ask for the next one if it still does not scroll.
  const loadLatestHistory = useCallback(
    (serverId: string, channelId: string) => {
      const key = scopeKey(serverId, channelId);
      const page: HistoryPage = { serverId, channelId, oldestId: null, exhausted: false, loading: true };
      historyPages.current.set(key, page);

      fetchHistoryPage(serverId, channelId, page)
        .then((messages) => {
          page.loading = false;
          const lines = linesToStore(historyPages.current, key, page, messages);
          if (lines) setHistory(key, lines);
        })
        .catch(() => {
          if (historyPages.current.get(key) === page) historyPages.current.delete(key);
        });
    },
    [setHistory, fetchHistoryPage],
  );

  useEffect(() => {
    if (!selectedServerId) return;
    if (historyPages.current.has(scopeKey(selectedServerId, selectedChannelId))) return;
    loadLatestHistory(selectedServerId, selectedChannelId);
  }, [selectedServerId, selectedChannelId, loadLatestHistory]);

  // Messages that arrived while the backend link was down were stored but never
  // reached this window. Each loaded channel that is still open (not DCC chats,
  // which keep no history) is emptied and fetched again; setHistory drops
  // anything that also comes in live meanwhile.
  const reloadHistory = useCallback(() => {
    const pages = pagesToReload(historyPages.current, useStore.getState().channelMap);
    clearMessages(pages.map((p) => scopeKey(p.serverId, p.channelId)));
    for (const p of pages) loadLatestHistory(p.serverId, p.channelId);
  }, [clearMessages, loadLatestHistory]);

  useEffect(
    () =>
      // Reloading only once every server is attached again leaves no gap where
      // a line is neither in the history read nor delivered live.
      window.irc.onBackendReconnected(() => {
        reconcile(reloadHistory);
      }),
    [reconcile, reloadHistory],
  );

  const loadOlderHistory = useCallback(() => {
    const key = scopeKey(selectedServerId, selectedChannelId);
    const page = historyPages.current.get(key);
    if (!selectedServerId || !canLoadOlder(page)) return;
    page.loading = true;

    fetchHistoryPage(selectedServerId, selectedChannelId, page)
      .then((messages) => {
        page.loading = false;
        const lines = linesToStore(historyPages.current, key, page, messages);
        if (lines) setHistory(key, lines);
      })
      .catch(() => {
        page.loading = false;
      });
  }, [selectedServerId, selectedChannelId, setHistory, fetchHistoryPage]);

  async function handleConnect(form: ConnectForm) {
    const id = crypto.randomUUID();
    const host = normalizeHost(form.host);
    const port = Number(form.port);
    const altNicks = parseList(form.altNicks);
    const autojoinChannels = parseList(form.autojoinChannels);
    const name = form.name.trim() || host;
    const remembered =
      form.remember &&
      (await window.irc
        .rememberSecrets(id, { password: form.password, saslUser: form.saslUser, saslPass: form.saslPass })
        .catch(() => false));
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
        rememberCredentials: remembered || undefined,
        connectOnStartup: form.connectOnStartup || undefined,
      },
      { id: `${id}:__log__`, name: 'Log', isLog: true },
    );
    addPreset({ id: buildServerId(host, port), name, host, port, secure: form.secure });
    setNick(id, form.nick);
    setSaslCreds(id, form.saslUser, form.saslPass);
    setServerPassword(id, form.password);
    const failure = await attemptConnect(id, setConnectionStatus, () =>
      window.irc.connect(
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
        form.password || undefined,
      ),
    );
    if (failure) logConnectFailure(id, failure);
    handleSelectServer(id);
    setConnectPrefill(null);
  }

  async function handleEditServer(id: string, form: EditServerForm) {
    const host = normalizeHost(form.host);
    const port = Number(form.port);
    const altNicks = parseList(form.altNicks);
    const autojoinChannels = parseList(form.autojoinChannels);
    const name = form.name.trim() || host;
    let remembered = false;
    if (form.remember) {
      remembered = await window.irc
        .rememberSecrets(id, { saslUser: form.saslUser, saslPass: form.saslPass })
        .catch(() => false);
    } else {
      await window.irc.forgetSecrets(id).catch(() => undefined);
    }
    updateServer(id, {
      rememberCredentials: remembered || undefined,
      name,
      initial: name[0]?.toUpperCase() ?? '?',
      host,
      port,
      secure: form.secure,
      altNicks,
      username: form.username || undefined,
      realname: form.realname || undefined,
      autojoinChannels,
      connectOnStartup: form.connectOnStartup || undefined,
    });
    setNick(id, form.nick);
    setSaslCreds(id, form.saslUser, form.saslPass);
    setView({ kind: 'chat' });
  }

  async function connectToServer(id = selectedServerId) {
    const server = servers.find((s) => s.id === id);
    if (!server) return;
    await connectServer(server);
  }

  async function handleDisconnect(id = selectedServerId) {
    await window.irc.disconnect(id);
    setConnectionStatus(id, 'disconnected');
  }

  // Connecting is already under way for 'connecting', so only the other two states act.
  function handleToggleConnection(id: string) {
    const status = statusMap[id] ?? 'disconnected';
    if (status === 'connected') return handleDisconnect(id);
    if (status === 'disconnected') return connectToServer(id);
  }

  async function handleRemoveServer(id: string) {
    const server = servers.find((s) => s.id === id);
    if (!confirm(`Remove ${server?.name ?? id}? This clears its local history.`)) return;
    await window.irc.disconnect(id);
    await window.irc.forgetSecrets(id).catch(() => undefined);
    dropServerPages(historyPages.current, id);
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
      if (channel && !channel.isQuery && channel.joined === true) {
        await window.irc.sendLine(selectedServerId, `PART ${channelId}`);
      }
    }
    // Forgetting how far back it was loaded makes a reopened channel start from its latest page.
    historyPages.current.delete(scopeKey(selectedServerId, channelId));
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

  // Every outgoing line that may ask a bot for a pack goes through here, typed or clicked.
  function sendTracked(serverId: string, line: string) {
    const bot = xdccRequestTarget(line);
    if (bot) requestedPacks.current.add(xdccRequestKey(serverId, bot));
    return window.irc.sendLine(serverId, line);
  }

  // A pack request from a button reads in the chat like the same line typed by hand.
  function requestPack(serverId: string, nick: string, packNumber: number) {
    const text = `XDCC SEND #${packNumber}`;
    ensureQuery(serverId, nick);
    sendTracked(serverId, `PRIVMSG ${nick} :${text}`);
    appendMessage(scopeKey(serverId, nick), {
      id: nextMsgId.current++,
      nick: nickMap[serverId] ?? '',
      text,
      timestamp: new Date(),
    });
  }

  function handleGetPack(nick: string, packNumber: number) {
    requestPack(selectedServerId, nick, packNumber);
  }

  function handleGetPackFrom(serverId: string, nick: string, packNumber: number) {
    ensureQuery(serverId, nick);
    handleSelectServer(serverId);
    handleSelectChannel(nick);
    requestPack(serverId, nick, packNumber);
    setShowSearch(false);
  }

  async function handleAcceptXDCCOffer(trust?: 'session' | 'always') {
    if (!pendingXDCCOffer) return;
    const offer = pendingXDCCOffer;
    setPendingXDCCOffer(null);
    const key = xdccSenderKey(offer);
    if (trust === 'session' && key) sessionTrusted.current.add(`${offer.serverId}\0${key}`);
    if (trust === 'always') trustXdccSender(offer.serverId, offer);
    await startXDCCDownload(offer);
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
      let page: HistoryEntry[];
      try {
        page = await window.irc.getHistory(selectedServerId, backendChannel, before, pageSize);
      } catch (err) {
        // abort rather than save a truncated export
        console.error('export failed:', err);
        return;
      }
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

  const awayStats = useMemo(
    () =>
      computeAwayStats(
        channels,
        selectedChannelId,
        (id) => lastReadMap[scopeKey(selectedServerId, id)] ?? 0,
        (id) => messageMap[scopeKey(selectedServerId, id)] ?? [],
      ),
    [channels, messageMap, lastReadMap, selectedServerId, selectedChannelId],
  );

  const selectedChannel = channels.find((c) => c.id === selectedChannelId) ?? channels[0];
  const allMessages = messageMap[scopeKey(selectedServerId, selectedChannelId)] ?? [];
  const messages = useMemo(
    () => (showMembershipEvents ? allMessages : allMessages.filter((m) => !m.membership)),
    [allMessages, showMembershipEvents],
  );
  const users = userMap[scopeKey(selectedServerId, selectedChannelId)] ?? [];
  const isLog = selectedChannel?.isLog ?? true;
  const isQuery = selectedChannel?.isQuery ?? false;
  const currentNick = nickMap[selectedServerId] ?? 'dolq_user';
  const connectionStatus = statusMap[selectedServerId] ?? 'disconnected';
  const [showMembers, setShowMembers] = useState(true);
  const [showTransfers, setShowTransfers] = useState(false);
  const mentionedHere = channels
    .filter((c) => mentionedChannels[c.id])
    .map((c) => ({ id: c.id, label: c.isQuery ? `@${c.name}` : `#${c.name}` }));
  const transferCount = Object.keys(transfers).length;
  // A new transfer brings the cards back even if they were hidden.
  const prevTransferCount = useRef(transferCount);
  useEffect(() => {
    if (transferCount > prevTransferCount.current) setShowTransfers(true);
    prevTransferCount.current = transferCount;
  }, [transferCount]);

  async function handleSend(text: string, aliasDepth = 0): Promise<void> {
    const joinMatch = text.match(/^\/join\s+(#\S+)(?:\s+(\S+))?$/);
    const meMatch = text.match(/^\/me\s+(.+)$/);
    const msgMatch = text.match(/^\/msg\s+(\S+)\s+(.+)$/);
    const awayMatch = text.match(/^\/away(?:\s+(.+))?$/);
    const aliasDefMatch = text.match(/^\/alias\s+(\S+)\s+(.+)$/);
    const whoisMatch = text.match(/^\/whois\s+(\S+)$/);
    const unaliasMatch = text.match(/^\/unalias\s+(\S+)$/);
    const aliasInvokeMatch = text.match(/^\/(\S+)(?:\s+(.*))?$/);
    const aliasName = aliasInvokeMatch?.[1].toLowerCase();
    const slash = parseSlashCommand(text, selectedChannelId);

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
      await sendTracked(selectedServerId, `PRIVMSG ${nick} :${msg}`);
      handleOpenQuery(nick);
      appendMessage(scopeKey(selectedServerId, nick), {
        id: nextMsgId.current++,
        nick: currentNick,
        text: msg,
        timestamp: new Date(),
      });
    } else if (whoisMatch) {
      handleWhois(whoisMatch[1]);
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
      await sendTracked(selectedServerId, text);
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
    } else if (slash.kind === 'raw') {
      await sendTracked(selectedServerId, slash.line);
    } else if (slash.kind === 'unknown') {
      appendMessage(scopeKey(selectedServerId, selectedChannelId), {
        id: nextMsgId.current++,
        nick: '',
        text: `Unknown or incomplete command: /${slash.name} (use //${slash.name} to send it as text)`,
        timestamp: new Date(),
        system: true,
      });
    } else {
      await sendTracked(
        selectedServerId,
        `PRIVMSG ${selectedChannelId} :${text.startsWith('//') ? text.slice(1) : text}`,
      );
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
          trustable={xdccSenderKey(pendingXDCCOffer) !== ''}
          onAccept={() => handleAcceptXDCCOffer()}
          onAcceptSession={() => handleAcceptXDCCOffer('session')}
          onAcceptAlways={() => handleAcceptXDCCOffer('always')}
          onDecline={handleDeclineXDCCOffer}
        />
      )}
      {showTransfers && (
        <TransferStatus
          transfers={transfers}
          onPause={handlePauseTransfer}
          onResume={handleResumeTransfer}
          onCancel={handleCancelTransfer}
          onDismiss={handleDismissTransfer}
        />
      )}
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
      <div className="flex shrink-0">
        <ServerList
          servers={servers}
          selectedId={selectedServerId}
          onSelect={handleSelectServer}
          onAddServer={() => setView({ kind: 'connect' })}
          onRemove={handleRemoveServer}
          onChangeColor={setServerColor}
          onEditServer={(id) => setView({ kind: 'editServer', serverId: id })}
          statusMap={statusMap}
          onToggleConnection={handleToggleConnection}
          onOpenPreferences={() => setView({ kind: 'preferences' })}
        />
        <div className="flex flex-col">
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
          />
          <UserPanel
            currentNick={currentNick}
            away={selfAwayMap[selectedServerId] ?? false}
            onToggleAway={() => handleSend(selfAwayMap[selectedServerId] ? '/away' : '/away Away')}
          />
        </div>
      </div>
      <main className="flex flex-col flex-1 bg-(--dolq-bg) overflow-hidden">
        {view.kind === 'connect' && (
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
        )}
        {view.kind === 'editServer' &&
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
          })()}
        {view.kind === 'preferences' && (
          <PreferencesModal
            settings={settings}
            onSave={handleSavePreferences}
            onCancel={() => setView({ kind: 'chat' })}
            notificationsEnabled={notificationsEnabled}
            onNotificationsEnabledChange={setNotificationsEnabled}
            soundAlertsEnabled={soundAlertsEnabled}
            onSoundAlertsEnabledChange={setSoundAlertsEnabled}
            showMembershipEvents={showMembershipEvents}
            onShowMembershipEventsChange={setShowMembershipEvents}
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
            xdccTrusted={xdccTrusted}
            onUntrustXdcc={untrustXdccSender}
            aliases={aliases}
            onRemoveAlias={removeAlias}
            keybindings={keybindings}
            onKeybindingChange={setKeybinding}
          />
        )}
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
              onOpenSearch={() => setShowSearch(true)}
              connectionStatus={connectionStatus}
              onToggleConnection={() => handleToggleConnection(selectedServerId)}
              muted={!!mutedChannels[selectedChannelId]}
              onToggleMute={isLog || isQuery ? undefined : () => toggleMuteChannel(selectedChannelId)}
              serverColor={selectedServer?.color}
              mentions={mentionedHere}
              onSelectMention={handleSelectChannel}
              transferCount={transferCount}
              showTransfers={showTransfers}
              onToggleTransfers={() => setShowTransfers((v) => !v)}
              showMembers={showMembers}
              onToggleMembers={isLog || isQuery ? undefined : () => setShowMembers((v) => !v)}
            />
            <MessageArea
              messages={messages}
              isLog={isLog}
              channelId={scopeKey(selectedServerId, selectedChannelId)}
              onLoadOlder={loadOlderHistory}
              timestampFormat={timestampFormat}
              density={messageDensity}
              onGetPack={handleGetPack}
              selfNick={currentNick}
            />
            <MessageInput
              channelName={selectedChannel?.name ?? ''}
              isLog={isLog}
              isQuery={isQuery}
              onSend={handleSend}
            />
          </div>
          {!isLog && !isQuery && showMembers && (
            <aside className="w-58 bg-(--dolq-bg-panel) border-l border-(--dolq-border) shrink-0 flex flex-col overflow-hidden">
              <div className="h-14 px-4 flex items-center justify-between shrink-0">
                <span className="font-semibold text-[15px] text-(--dolq-text)">Members</span>
                <span className="text-[12px] text-(--dolq-text-dim)">{users.length} online</span>
              </div>
              <UserList
                users={users}
                currentNick={currentNick}
                onOpenQuery={handleOpenQuery}
                onWhois={handleWhois}
                ignoredNicks={ignoredNicks[selectedServerId] ?? []}
                onToggleIgnore={handleToggleIgnore}
                onDCCOffer={handleDCCOffer}
              />
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
