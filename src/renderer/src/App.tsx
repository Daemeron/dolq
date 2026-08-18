import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message, Server } from './types';
import type { HistoryEntry, IrcEvent, Settings } from '../../shared/ipc';
import { useStore } from './store';
import { ServerList } from './components/ServerList';
import { ChannelList } from './components/ChannelList';
import { TopicBar } from './components/TopicBar';
import { MessageArea } from './components/MessageArea';
import { UserList } from './components/UserList';
import { MessageInput } from './components/MessageInput';
import { ConnectModal, parseList, type ConnectForm } from './components/ConnectModal';
import { PreferencesModal } from './components/PreferencesModal';
import { WhoisModal } from './components/WhoisModal';
import { DCCOfferModal } from './components/DCCOfferModal';
import { XDCCOfferModal } from './components/XDCCOfferModal';
import { TransferStatus, type Transfer } from './components/TransferStatus';
import { SearchModal } from './components/SearchModal';
import { NickServIdentifyModal } from './components/NickServIdentifyModal';
import { isNickServIdentifyPrompt } from './utils/nickserv';
import { expandAlias } from './utils/aliases';
import { UserPanel } from './components/UserPanel';
import { buildServerId, normalizeHost, resolveHostPort } from './utils/server';
import { mentionsNick } from './utils/mentions';
import { formatEntry } from './utils/exportFormat';

// How many rows getHistory fetches per page - both for the initial preload
// and each scroll-up-triggered older page. Also doubles as the "is there
// more?" signal: fewer than this many back means we've hit the beginning.
const HISTORY_PAGE_SIZE = 100;

// An alias expanding to another (or, worse, back to itself) could recurse
// forever - this is the ceiling, not a real limit anyone should hit with
// normal aliases, just a guard against a self-inflicted infinite loop.
const MAX_ALIAS_DEPTH = 8;

// Preferences' Font Size, as Electron page-zoom factors (see the fontSize
// effect above) - modest values, not a browser tab's full zoom range, so
// "large" doesn't start clipping the sidebar's fixed-width panels.
const FONT_SIZE_ZOOM: Record<'small' | 'medium' | 'large', number> = {
  small: 0.9,
  medium: 1,
  large: 1.15,
};

// Preferences' Font Family presets - 'system' is exactly index.css's own
// default stack (see :root there), so picking it back after trying another
// preset looks identical to never having changed it at all.
const FONT_FAMILY_STACKS: Record<'system' | 'serif' | 'monospace', string> = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  serif: "Georgia, 'Times New Roman', Times, serif",
  monospace: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
};

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
    } else if (e.event?.type === 'XDCCPACK') {
      const p = e.event;
      messages.push({
        id: e.id, nick: p.nick, timestamp, xdccPack: true, xdccPackNumber: p.number,
        text: `#${p.number} · ${p.gets}x sent · ${p.size} · ${p.filename}`,
      });
    }
  }
  return messages;
}

// Per-channel scrollback paging state - bookkeeping, not render state, so
// it lives outside the (unpersisted) store like historyLoaded did before it.
type HistoryPage = { oldestId: number | null; exhausted: boolean; loading: boolean };

// Electron's renderer implements the standard web Notification API directly
// - no IPC/main-process round trip needed. Guarded by typeof in case it's
// ever unavailable (e.g. a future headless/test environment).
function notify(title: string, body: string, onClick: () => void): void {
  if (typeof Notification === 'undefined') return;
  const n = new Notification(title, { body });
  n.onclick = onClick;
}

export default function App() {
  const {
    servers, presets, channelMap, messageMap, userMap, nickMap, saslMap,
    selectedServerId, selectedChannelId, statusMap, mentionedChannels, notificationsEnabled, soundAlertsEnabled, mutedChannels,
    timestampFormat, messageDensity, fontSize, fontFamily, ignoredNicks, selfAwayMap, aliases,
    addServer, removeServer, addPreset, addChannel, removeChannel, setTopic, setTopicWhoTime, appendMessage, setHistory, setNick, setSaslCreds,
    selectServer, selectChannel, setConnectionStatus, setUsers, addUser, removeUser, removeUserEverywhere,
    renameUserEverywhere, applyModeChanges, markMentioned, toggleMuteChannel, setNotificationsEnabled, setSoundAlertsEnabled, setTimestampFormat,
    setMessageDensity, setFontSize, setFontFamily, addIgnore, removeIgnore, applyAwayEverywhere, setSelfAway, setAlias, removeAlias,
  } = useStore();

  const [showModal, setShowModal] = useState(false);
  // Prefill for the connect form from a clicked irc(s):// link (see the
  // onOpenIrcUrl effect below) - null opens the form with its plain
  // defaults, same as clicking "Add a Server" normally does.
  const [connectPrefill, setConnectPrefill] = useState<
    { host: string; port: number; secure: boolean; channel?: string } | null
  >(null);
  const [showPreferences, setShowPreferences] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  // Not in the zustand store: unlike everything else there, these belong to
  // the main process (not per-server, and read from disk before the
  // renderer even exists - see src/main/settings.ts), so the renderer just
  // mirrors whatever it last fetched/saved rather than owning them.
  const [settings, setSettingsState] = useState<Settings>({ retentionDays: 0 });
  // The nick a WHOIS is currently open for (drives the modal, and matches
  // against incoming 'whois' events - see the onEvent switch below);
  // whoisResult stays null until that reply actually arrives.
  const [whoisNick, setWhoisNick] = useState<string | null>(null);
  const [whoisResult, setWhoisResult] = useState<Extract<IrcEvent, { type: 'whois' }> | null>(null);
  // An incoming DCC CHAT offer awaiting accept/decline - see the
  // DCCCHATOFFER case below and DCCOfferModal.
  const [pendingDCCOffer, setPendingDCCOffer] = useState<{ serverId: string; nick: string; ip: string; port: number } | null>(null);
  // An incoming DCC SEND offer (an XDCC bot answering "XDCC SEND #n")
  // awaiting accept/decline - same reasoning as pendingDCCOffer, a file
  // transfer connects straight to the sender's address too.
  const [pendingXDCCOffer, setPendingXDCCOffer] = useState<
    { serverId: string; nick: string; filename: string; ip: string; port: number; size: number; token?: string } | null
  >(null);
  // Transfers xdccAccept has started, keyed by its own id - not a channel,
  // just the transfer manager's own queue (see TransferStatus and the
  // XDCCTRANSFER case below). Kept around (not deleted) once done/errored,
  // until the user dismisses it - see handleDismissTransfer.
  const [transfers, setTransfers] = useState<
    Record<string, Transfer & { serverId: string; path: string }>
  >({});
  // Per-transfer bookkeeping for the speed shown in TransferStatus - not
  // render state itself (nothing reads it directly), just what the next
  // XDCCTRANSFER needs to compute a bytes/sec delta against. A ref, not
  // state, so updating it doesn't itself trigger a re-render.
  const transferSpeedTrack = useRef<Record<string, { received: number; at: number }>>({});
  // The server a NickServ identify prompt (see utils/nickserv.ts) most
  // recently arrived on, if it hasn't been dismissed/actioned yet.
  const [pendingIdentifyServerId, setPendingIdentifyServerId] = useState<string | null>(null);
  const nextMsgId = useRef(Date.now());
  const historyPages = useRef(new Map<string, HistoryPage>());

  useEffect(() => {
    window.irc.getSettings().then(setSettingsState);
  }, []);

  // Reflects unread-mention count on the dock icon (see main/index.ts's
  // tray/setBadgeCount handler). mentionedChannels is the only "unread"-
  // shaped signal this app tracks at all, so the badge just mirrors its
  // size rather than a separate count kept only for this.
  useEffect(() => {
    window.irc.setBadgeCount(Object.keys(mentionedChannels).length);
  }, [mentionedChannels]);

  // Preferences' Font Size - see store.ts's fontSize doc for why this is a
  // whole-window zoom rather than a CSS font-size.
  useEffect(() => {
    window.irc.setZoomFactor(FONT_SIZE_ZOOM[fontSize]);
  }, [fontSize]);

  // Preferences' Font Family - a plain CSS custom property (see index.css),
  // unlike fontSize this doesn't need main-process involvement at all.
  useEffect(() => {
    document.documentElement.style.setProperty('--dolq-font-family', FONT_FAMILY_STACKS[fontFamily]);
  }, [fontFamily]);

  async function handleSavePreferences(next: Settings) {
    await window.irc.setSettings(next);
    setSettingsState(next);
    setShowPreferences(false);
  }

  // Both the initial preload and loadOlderHistory below need the bare
  // '__log__' key the backend stores raw lines under - the "__log__" suffix
  // is only ever added to the messageMap/UI-facing channel id.
  function backendChannelFor(serverId: string, channelId: string): string {
    const channel = channelMap[serverId]?.find((c) => c.id === channelId);
    return channel?.isLog ? '__log__' : channelId;
  }

  // ConnectModal's "pick a preset -> prefill last-used nick" convenience
  // needs a preset (host:port)-keyed map, but nickMap is keyed by identity
  // (Server.id) - not the same thing since a preset's network can now have
  // more than one identity/id pointing at it. Rebuilt from whichever
  // identity happens to be last in `servers` for that network, a fine tie-
  // break for what's just a form-prefill convenience.
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

  // A clicked irc(s):// link (see main/index.ts's handleIrcUrl/parseIrcUrl)
  // opens the same "Add a Server" form a manual click would, just pre-
  // filled - connecting from it is still the user's own explicit action,
  // same "don't auto-connect to an address you didn't choose" posture as
  // accepting a DCC/XDCC offer.
  useEffect(() => {
    return window.irc.onOpenIrcUrl((prefill) => {
      setConnectPrefill(prefill);
      setShowModal(true);
    });
  }, []);

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
  //
  // A genuine app restart (as opposed to a renderer-only reload) means dolqd
  // itself is a fresh process with no sessions at all, so getStatus comes back
  // 'disconnected' for every server regardless of whether it was connected when
  // the app last quit - `before-quit` PARTs/QUITs everything on the way out,
  // there's nothing left to reconcile against. Rather than add a persisted
  // "was connected" flag just to tell that apart from a server that was never
  // successfully connected, auto-reconnect treats every configured server the
  // same way a fresh launch of most IRC clients does: dial them all, same as
  // clicking Connect would.
  useEffect(() => {
    async function reconcile() {
      const { servers, channelMap } = useStore.getState();
      for (const s of servers) {
        const status = await window.irc.getStatus(s.id);
        setConnectionStatus(s.id, status);

        if (status === 'connected') {
          const joined = new Set(await window.irc.getJoinedChannels(s.id));
          (channelMap[s.id] ?? []).forEach((ch) => {
            if (!ch.isLog && joined.has(ch.id)) window.irc.sendLine(s.id, `NAMES ${ch.id}`);
          });
          continue;
        }

        try {
          await connectServer(s);
        } catch {
          // Same failure a manual Connect click can hit (bad host, network
          // down) - leave it 'disconnected' so the user can retry, and don't
          // let it stop the rest of servers from being attempted.
          setConnectionStatus(s.id, 'disconnected');
        }
      }
    }
    if (useStore.persist.hasHydrated()) {
      reconcile();
      return;
    }
    return useStore.persist.onFinishHydration(reconcile);
  }, [setConnectionStatus]);

  // A DCC session's channel lives under whichever server initiated/accepted
  // it (see handleDCCOffer/handleAcceptDCC), keyed by its dccId same as any
  // other channel - this just has to search every server's list to find it,
  // since a raw onLine callback isn't given which one.
  function dccPeerNick(dccId: string): string {
    for (const channels of Object.values(channelMap)) {
      const ch = channels.find((c) => c.id === dccId);
      if (ch) return ch.name;
    }
    return '';
  }

  useEffect(() => {
    return window.irc.onLine((serverId, line) => {
      // A DCC CHAT session (see the ROADMAP note) isn't a real serverId -
      // its lines are the chat itself, not raw IRC protocol traffic to
      // stash in a Log bucket, so they go straight into the session's own
      // channel instead.
      if (serverId.startsWith('dcc:')) {
        appendMessage(serverId, {
          id: nextMsgId.current++, nick: dccPeerNick(serverId), text: line, timestamp: new Date(),
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
  }, [appendMessage, channelMap]);

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

  // Own-nick mention in a channel (not a query - see the ROADMAP note)
  // you're not currently looking at: highlights it in the sidebar
  // (markMentioned, cleared on selecting it - see store.ts) and, if enabled,
  // fires a desktop notification that jumps you straight there. A muted
  // channel (see toggleMuteChannel) skips both - not just the notification -
  // same as Discord's own mute suppressing the unread highlight too.
  function checkMention(serverId: string, channelId: string, target: string, text: string) {
    if (!target.startsWith('#') || channelId === selectedChannelId || mutedChannels[channelId]) return;
    if (!mentionsNick(text, nickMap[serverId])) return;
    markMentioned(channelId);
    if (notificationsEnabled) {
      notify(`Mentioned in ${channelId}`, text, () => {
        selectServer(serverId);
        selectChannel(channelId);
      });
    }
    // A separate toggle from notificationsEnabled (see store.ts's doc) -
    // same trigger, independent on/off.
    if (soundAlertsEnabled) window.irc.playAlertSound();
  }

  // A message never even reaches dmKey - an ignored nick DMing you doesn't
  // pop open a new query either. Scoped to actual chat content (PRIVMSG/
  // ACTION/NOTICE), not JOIN/PART/QUIT/etc. - "ignore" here means "stop
  // showing me what they say", not "pretend they don't exist".
  function isIgnored(serverId: string, nick: string): boolean {
    return (ignoredNicks[serverId] ?? []).includes(nick);
  }

  useEffect(() => {
    return window.irc.onEvent((serverId, event) => {
      switch (event.type) {
        case 'PRIVMSG': {
          if (isIgnored(serverId, event.nick)) break;
          const key = dmKey(serverId, event.target, event.nick);
          appendMessage(key, { id: nextMsgId.current++, nick: event.nick, text: event.text, timestamp: new Date() });
          checkMention(serverId, key, event.target, event.text);
          break;
        }
        case 'ACTION': {
          if (isIgnored(serverId, event.nick)) break;
          const key = dmKey(serverId, event.target, event.nick);
          appendMessage(key, {
            id: nextMsgId.current++, nick: event.nick, text: event.text, timestamp: new Date(), action: true,
          });
          checkMention(serverId, key, event.target, event.text);
          break;
        }
        case 'NOTICE':
          // A private NOTICE isn't routed anywhere here - it already shows
          // up as a raw line in the Log (onLine above), same as before this
          // was parsed at all. Only channel notices get the nicer per-channel
          // rendering, same reasoning as toMessages above.
          if (event.target.startsWith('#') && !isIgnored(serverId, event.nick)) {
            appendMessage(event.target, {
              id: nextMsgId.current++, nick: event.nick, text: event.text, timestamp: new Date(), notice: true,
            });
          }
          if (isNickServIdentifyPrompt(event.nick, event.text)) {
            setPendingIdentifyServerId(serverId);
          }
          break;
        case 'XDCCPACK': {
          // Unlike a private NOTICE, this is worth surfacing somewhere
          // findable - the whole point of parsing it - so route it the same
          // way a DM would land: the bot's own query, auto-opened if needed.
          if (isIgnored(serverId, event.nick)) break;
          const key = dmKey(serverId, event.target, event.nick);
          appendMessage(key, {
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
          // Our own nick, not just someone else's in a shared channel's user
          // list - nickMap is what JOIN/KICK above compare against to tell
          // "us" from "someone else", and what UserPanel displays.
          if (event.oldNick === nickMap[serverId]) setNick(serverId, event.newNick);
          break;
        case 'WELCOME':
          // Authoritative: the nick we asked for at connect time might not
          // be the one that actually got registered (see NICKINUSE below).
          setNick(serverId, event.nick);
          // Registration just completed - now's the only time to autojoin,
          // there's nothing else that marks "freshly (re)connected".
          servers.find((s) => s.id === serverId)?.autojoinChannels?.forEach((ch) =>
            window.irc.sendLine(serverId, `JOIN ${ch}`),
          );
          break;
        case 'NICKINUSE': {
          const text = event.retrying
            ? `Nickname "${event.nick}" is already in use - trying "${event.retrying}" instead.`
            : `Nickname "${event.nick}" is already in use.`;
          appendMessage(`${serverId}:__log__`, {
            id: nextMsgId.current++, nick: '', text, timestamp: new Date(), system: true,
          });
          break;
        }
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
        case 'whois':
          if (event.nick === whoisNick) setWhoisResult(event);
          break;
        case 'DCCCHATOFFER':
          // Last offer wins if more than one arrives before this is
          // resolved - a real edge case, not worth a queue for.
          setPendingDCCOffer({ serverId, nick: event.nick, ip: event.ip, port: event.port });
          break;
        case 'XDCCSENDOFFER':
          setPendingXDCCOffer({
            serverId, nick: event.nick, filename: event.filename, ip: event.ip, port: event.port,
            size: event.size, token: event.token,
          });
          break;
        case 'XDCCTRANSFER': {
          // serverId here is really the xdccAccept-returned transfer id
          // (see xdccAccept's doc) - onEvent is generic over "some id" the
          // same way onLine/onStatus already are for DCC CHAT.
          const id = serverId;
          if (event.done || event.error) {
            delete transferSpeedTrack.current[id];
            setTransfers((prev) => {
              const t = prev[id];
              if (!t) return prev; // dismissed/cancelled locally already
              const text = event.error
                ? `Download of ${t.filename} failed: ${event.error}`
                : `Downloaded ${t.filename} to ${event.path}`;
              ensureQuery(t.serverId, t.nick);
              appendMessage(t.nick, { id: nextMsgId.current++, nick: '', text, timestamp: new Date(), system: true });
              return { ...prev, [id]: { ...t, received: event.received, total: event.total, path: event.path, done: event.done, error: event.error } };
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
            return { ...prev, [id]: { ...t, received: event.received, total: event.total, speedBps: speedBps ?? t.speedBps } };
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
    appendMessage, addChannel, selectChannel, addUser, removeUser,
    removeUserEverywhere, renameUserEverywhere, applyModeChanges, setUsers, setTopic, setTopicWhoTime, nickMap,
    channelMap, setNick, servers, selectedChannelId, selectServer, markMentioned, notificationsEnabled, soundAlertsEnabled, mutedChannels,
    whoisNick, ignoredNicks, applyAwayEverywhere, setSelfAway,
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
    // Freshly generated, not derived from host:port - see types.ts's
    // Server.id doc. Multiple identities on the same network end up as
    // multiple Server entries with different ids, all pointing at the same
    // host/port; nickMap/saslMap/channelMap/etc. are already keyed by id,
    // so they naturally stay per-identity without any further change.
    const id = crypto.randomUUID();
    const host = normalizeHost(form.host);
    const port = Number(form.port);
    const altNicks = parseList(form.altNicks);
    const autojoinChannels = parseList(form.autojoinChannels);
    addServer(
      {
        id, name: form.name, initial: form.name[0]?.toUpperCase() ?? '?', secure: form.secure, host, port,
        altNicks, username: form.username || undefined, realname: form.realname || undefined, autojoinChannels,
      },
      { id: `${id}:__log__`, name: 'Log', isLog: true },
    );
    // Unlike id, still host:port - the preset list is "networks you've
    // connected to before", deduped per-network regardless of how many
    // identities you've since added for one (see addPreset in store.ts).
    addPreset({ id: buildServerId(host, port), name: form.name, host, port, secure: form.secure });
    setNick(id, form.nick);
    setSaslCreds(id, form.saslUser, form.saslPass);
    setConnectionStatus(id, 'connecting');
    await window.irc.connect(
      id, host, port, form.nick, form.secure, form.saslUser, form.saslPass,
      form.username, form.realname, altNicks,
    );
    setConnectionStatus(id, 'connected');
    selectServer(id);
    setShowModal(false);
    setConnectPrefill(null);
  }

  // Shared by the manual "Connect" button (connectToServer) and the
  // reconcile-on-hydration auto-reconnect above. Reads nick/SASL via
  // getState() rather than the destructured nickMap/saslMap for the same
  // reason reconcile does - it can run before a post-hydration re-render.
  async function connectServer(server: Server) {
    const { host, port } = resolveHostPort(server);
    const { nickMap, saslMap } = useStore.getState();
    const nick = nickMap[server.id] ?? 'dolq_user';
    const sasl = saslMap[server.id];
    setConnectionStatus(server.id, 'connecting');
    await window.irc.connect(
      server.id, host, port, nick, server.secure, sasl?.user, sasl?.pass,
      server.username, server.realname, server.altNicks,
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
      const joined = (userMap[channelId] ?? []).some((u) => u.nick === currentNick);
      if (joined) await window.irc.sendLine(selectedServerId, `PART ${channelId}`);
    }
    removeChannel(selectedServerId, channelId);
  }

  function handleOpenQuery(nick: string) {
    ensureQuery(selectedServerId, nick);
    selectChannel(nick);
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

  // Offers a DCC CHAT to nick over the currently selected server - opens
  // (and switches to) its channel right away, in the "connecting" status
  // getStatus/onStatus already report generically; see dccPeerNick for how
  // its lines find their way back to it.
  async function handleDCCOffer(nick: string) {
    const id = await window.irc.dccOffer(selectedServerId, nick);
    addChannel(selectedServerId, { id, name: nick, isLog: false, isQuery: true, isDCC: true });
    selectChannel(id);
  }

  async function handleAcceptDCCOffer() {
    if (!pendingDCCOffer) return;
    const { serverId, nick, ip, port } = pendingDCCOffer;
    setPendingDCCOffer(null);
    const id = await window.irc.dccAccept(ip, port);
    addChannel(serverId, { id, name: nick, isLog: false, isQuery: true, isDCC: true });
    selectServer(serverId);
    selectChannel(id);
  }

  function handleDeclineDCCOffer() {
    setPendingDCCOffer(null);
  }

  // Requesting a pack is just the bot's own convention over plain PRIVMSG -
  // the reply (an XDCCSENDOFFER, if the bot answers at all) is what
  // actually needs handling, above.
  function handleGetPack(nick: string, packNumber: number) {
    window.irc.sendLine(selectedServerId, `PRIVMSG ${nick} :XDCC SEND #${packNumber}`);
  }

  // Same request, for a pack a global search hit turned up (see
  // SearchModal's "Packs only" filter) - unlike handleGetPack, serverId
  // isn't necessarily the currently selected one, so this also switches to
  // it and opens the bot's query first, same as accepting an offer does.
  function handleGetPackFrom(serverId: string, nick: string, packNumber: number) {
    ensureQuery(serverId, nick);
    selectServer(serverId);
    selectChannel(nick);
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

  // Dismisses a finished (done or errored) entry from the transfer manager
  // - unlike handleCancelTransfer, there's nothing left running to tell the
  // backend about, this is purely local list bookkeeping.
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

  // A search result's channel is the backend key (see backendChannelFor) -
  // "__log__" for the Log, needing the same reverse lookup the search
  // preload path never had to do since it's always scoped to one channel
  // whose sidebar id you already know.
  function handleJumpToSearchResult(serverId: string, channel: string) {
    selectServer(serverId);
    if (channel === '__log__') {
      const logCh = (channelMap[serverId] ?? []).find((c) => c.isLog);
      selectChannel(logCh?.id ?? '__log__');
    } else {
      selectChannel(channel);
    }
    setShowSearch(false);
  }

  // Pages backwards through the whole channel's history the same way
  // loadOlderHistory does (oldestId cursor, exhausted once a page comes
  // back short), just running to completion instead of one page at a time.
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

  const channels = channelMap[selectedServerId] ?? [];
  const selectedChannel = channels.find((c) => c.id === selectedChannelId) ?? channels[0];
  const messages = messageMap[selectedChannelId] ?? [];
  const users = userMap[selectedChannelId] ?? [];
  const isLog = selectedChannel?.isLog ?? true;
  const isQuery = selectedChannel?.isQuery ?? false;
  const currentNick = nickMap[selectedServerId] ?? 'dolq_user';
  const connectionStatus = statusMap[selectedServerId] ?? 'disconnected';

  async function handleSend(text: string, aliasDepth = 0): Promise<void> {
    const joinMatch = text.match(/^\/join\s+(#\S+)$/);
    const meMatch = text.match(/^\/me\s+(.+)$/);
    const msgMatch = text.match(/^\/msg\s+(\S+)\s+(.+)$/);
    const awayMatch = text.match(/^\/away(?:\s+(.+))?$/);
    const aliasDefMatch = text.match(/^\/alias\s+(\S+)\s+(.+)$/);
    const unaliasMatch = text.match(/^\/unalias\s+(\S+)$/);
    // Checked last, as a fallback - a built-in command above always wins
    // even if someone names an alias the same thing (that alias just never
    // becomes reachable, same as it not existing).
    const aliasInvokeMatch = text.match(/^\/(\S+)(?:\s+(.*))?$/);
    const aliasName = aliasInvokeMatch?.[1].toLowerCase();

    if (text === '/connect') {
      if (connectionStatus === 'disconnected') connectToServer();
    } else if (text === '/disconnect') {
      handleDisconnect();
    } else if (joinMatch) {
      await window.irc.sendLine(selectedServerId, `JOIN ${joinMatch[1]}`);
    } else if (awayMatch) {
      // No message clears it (RFC: bare AWAY marks you back), same as
      // typing plain "/away".
      await window.irc.sendLine(selectedServerId, awayMatch[1] ? `AWAY :${awayMatch[1]}` : 'AWAY');
    } else if (msgMatch) {
      const [, nick, msg] = msgMatch;
      await window.irc.sendLine(selectedServerId, `PRIVMSG ${nick} :${msg}`);
      handleOpenQuery(nick);
      appendMessage(nick, { id: nextMsgId.current++, nick: currentNick, text: msg, timestamp: new Date() });
    } else if (aliasDefMatch) {
      setAlias(aliasDefMatch[1].toLowerCase(), aliasDefMatch[2]);
    } else if (unaliasMatch) {
      removeAlias(unaliasMatch[1].toLowerCase());
    } else if (aliasName && aliases[aliasName]) {
      if (aliasDepth >= MAX_ALIAS_DEPTH) {
        console.warn(`alias expansion too deep, stopping at "/${aliasName}"`);
        return;
      }
      // Re-enters this same function with the expanded text, so an alias
      // expanding to e.g. "/me waves" or another alias goes through every
      // check above exactly as if it had been typed directly.
      await handleSend(expandAlias(aliases[aliasName], aliasInvokeMatch?.[2] ?? ''), aliasDepth + 1);
    } else if (selectedChannel?.isLog) {
      await window.irc.sendLine(selectedServerId, text);
    } else if (selectedChannel?.isDCC) {
      // Plain text straight to the peer, no IRC framing (not even CTCP
      // ACTION for /me - DCC CHAT is just a raw line-oriented socket, kept
      // that simple here too).
      await window.irc.dccSend(selectedChannelId, text);
      appendMessage(selectedChannelId, {
        id: nextMsgId.current++, nick: currentNick, text, timestamp: new Date(),
      });
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
          nickMap={presetNickMap()}
          onConnect={handleConnect}
          onCancel={() => { setShowModal(false); setConnectPrefill(null); }}
          initial={connectPrefill ?? undefined}
        />
      )}
      {showPreferences && (
        <PreferencesModal
          settings={settings}
          onSave={handleSavePreferences}
          onCancel={() => setShowPreferences(false)}
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
          servers={servers}
          ignoredNicks={ignoredNicks}
          onRemoveIgnore={removeIgnore}
          aliases={aliases}
          onRemoveAlias={removeAlias}
        />
      )}
      {whoisNick && (
        <WhoisModal
          nick={whoisNick}
          result={whoisResult}
          onClose={() => { setWhoisNick(null); setWhoisResult(null); }}
        />
      )}
      {pendingDCCOffer && (
        <DCCOfferModal
          nick={pendingDCCOffer.nick}
          onAccept={handleAcceptDCCOffer}
          onDecline={handleDeclineDCCOffer}
        />
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
          defaultChannelLabel={isLog ? 'Log' : isQuery ? (selectedChannel?.name ?? '') : `#${selectedChannel?.name ?? ''}`}
          onJump={handleJumpToSearchResult}
          onGetPack={handleGetPackFrom}
          onClose={() => setShowSearch(false)}
        />
      )}
      {pendingIdentifyServerId && (
        <NickServIdentifyModal
          onIdentify={handleIdentify}
          onDismiss={() => setPendingIdentifyServerId(null)}
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
            mentionedChannels={mentionedChannels}
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
            connectionStatus={connectionStatus}
            away={selfAwayMap[selectedServerId] ?? false}
            onConnect={connectToServer}
            onDisconnect={handleDisconnect}
            onOpenPreferences={() => setShowPreferences(true)}
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
          isDCC={selectedChannel?.isDCC}
          dccStatus={selectedChannel?.isDCC ? statusMap[selectedChannelId] : undefined}
          onExport={selectedChannel?.isDCC ? undefined : handleExportChannel}
        />
        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-col flex-1 overflow-hidden">
            <MessageArea
              messages={messages}
              isLog={isLog}
              channelId={selectedChannelId}
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
          <aside className="w-52 bg-[#1c1c1c] border-l border-[#2a2a2a] shrink-0 flex flex-col overflow-hidden">
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
          </aside>
        </div>
      </main>
    </div>
  );
}
