import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { type Server, type Channel, type Message, type User } from './types';
import { PUBLIC_SERVERS, type ServerPreset } from './data/servers';
import { type PrivilegeLevel } from '../../shared/ipc';

type State = {
  servers: Server[];
  presets: ServerPreset[];
  channelMap: Record<string, Channel[]>;
  messageMap: Record<string, Message[]>;
  userMap: Record<string, User[]>;
  nickMap: Record<string, string>;
  selectedServerId: string;
  selectedChannelId: string;
  statusMap: Record<string, 'disconnected' | 'connecting' | 'connected'>;
  // SASL credentials, kept only for the running session (see partialize) -
  // never written to localStorage in plaintext. Re-entering them after an
  // app restart is the accepted tradeoff until there's a real credential
  // store to put them in.
  saslMap: Record<string, { user: string; pass: string }>;
  // Channels with an unseen own-nick mention - cleared on selecting the
  // channel (see selectChannel), so like statusMap/userMap there's nothing
  // meaningful to restore from a previous session; excluded from partialize.
  mentionedChannels: Record<string, boolean>;
  notificationsEnabled: boolean;
  // Channels that never mark mentionedChannels or fire a desktop
  // notification, no matter what's said in them - see App.tsx's
  // checkMention. Keyed by bare channel id, same as mentionedChannels
  // (so, like it, two different servers' same-named channels share one
  // entry - an existing simplification, not new here). Persisted like
  // ignoredNicks, since it's a standing preference, not per-session state.
  mutedChannels: Record<string, boolean>;
  timestampFormat: '12h' | '24h';
  messageDensity: 'cozy' | 'compact';
  // Per-server (see ROADMAP's "per-network" - serverId is this app's only
  // notion of a network boundary already, same as nickMap/saslMap/etc.)
  // ignore list - purely a client-side display filter, nothing sent to the
  // server (IRC has no native "ignore").
  ignoredNicks: Record<string, string[]>;
  // Whether *we* are marked away, per server - not persisted, same as
  // statusMap: it reflects the live connection's actual state, which a
  // fresh session starts not knowing (there's no away-status equivalent of
  // getStatus/getJoinedChannels to reconcile it from on reload).
  selfAwayMap: Record<string, boolean>;
  // /alias shortcuts (see utils/aliases.ts) - global, not per-server: a
  // typing shortcut isn't a protocol/network concept the way SASL creds or
  // autojoin are, so there's no reason to scope it to one.
  aliases: Record<string, string>;
};

type Actions = {
  addServer: (server: Server, logChannel: Channel) => void;
  removeServer: (id: string) => void;
  addPreset: (preset: ServerPreset) => void;
  addChannel: (serverId: string, channel: Channel) => void;
  removeChannel: (serverId: string, channelId: string) => void;
  setTopic: (serverId: string, channelId: string, topic: string) => void;
  setTopicWhoTime: (serverId: string, channelId: string, nick: string, setAt: Date) => void;
  appendMessage: (key: string, msg: Message) => void;
  setHistory: (key: string, messages: Message[]) => void;
  setUsers: (channelId: string, users: User[]) => void;
  addUser: (channelId: string, user: User) => void;
  removeUser: (channelId: string, nick: string) => void;
  applyModeChanges: (channelId: string, changes: { nick: string; privilege: Exclude<PrivilegeLevel, 'none'>; granted: boolean }[]) => void;
  removeUserEverywhere: (nick: string) => void;
  renameUserEverywhere: (oldNick: string, newNick: string) => void;
  setNick: (serverId: string, nick: string) => void;
  setSaslCreds: (serverId: string, user: string, pass: string) => void;
  selectServer: (id: string) => void;
  selectChannel: (id: string) => void;
  setConnectionStatus: (serverId: string, status: 'disconnected' | 'connecting' | 'connected') => void;
  markMentioned: (channelId: string) => void;
  toggleMuteChannel: (channelId: string) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setTimestampFormat: (format: '12h' | '24h') => void;
  setMessageDensity: (density: 'cozy' | 'compact') => void;
  addIgnore: (serverId: string, nick: string) => void;
  removeIgnore: (serverId: string, nick: string) => void;
  applyAwayEverywhere: (nick: string, away: boolean) => void;
  setSelfAway: (serverId: string, away: boolean) => void;
  setAlias: (name: string, template: string) => void;
  removeAlias: (name: string) => void;
};

export const useStore = create<State & Actions>()(
  persist(
    (set, get) => ({
      servers: [],
      presets: PUBLIC_SERVERS,
      channelMap: {},
      messageMap: {},
      userMap: {},
      nickMap: {},
      selectedServerId: '',
      selectedChannelId: '__log__',
      statusMap: {},
      saslMap: {},
      mentionedChannels: {},
      notificationsEnabled: true,
      mutedChannels: {},
      timestampFormat: '12h',
      messageDensity: 'cozy',
      ignoredNicks: {},
      selfAwayMap: {},
      aliases: {},

      addServer: (server, logChannel) =>
        set((s) => ({
          servers: [...s.servers, server],
          channelMap: { ...s.channelMap, [server.id]: [logChannel] },
          messageMap: { ...s.messageMap, [logChannel.id]: [] },
        })),

      removeServer: (id) =>
        set((s) => {
          const servers = s.servers.filter((sv) => sv.id !== id);
          const channelIds = (s.channelMap[id] ?? []).map((c) => c.id);

          const channelMap = { ...s.channelMap };
          delete channelMap[id];
          const messageMap = { ...s.messageMap };
          const userMap = { ...s.userMap };
          channelIds.forEach((cid) => {
            delete messageMap[cid];
            delete userMap[cid];
          });
          const nickMap = { ...s.nickMap };
          delete nickMap[id];
          const statusMap = { ...s.statusMap };
          delete statusMap[id];
          const saslMap = { ...s.saslMap };
          delete saslMap[id];
          const ignoredNicks = { ...s.ignoredNicks };
          delete ignoredNicks[id];
          const selfAwayMap = { ...s.selfAwayMap };
          delete selfAwayMap[id];

          if (s.selectedServerId !== id) {
            return { servers, channelMap, messageMap, userMap, nickMap, statusMap, saslMap, ignoredNicks, selfAwayMap };
          }

          const selectedServerId = servers[0]?.id ?? '';
          const remainingChannels = channelMap[selectedServerId] ?? [];
          const logCh = remainingChannels.find((c) => c.isLog);
          const selectedChannelId = logCh?.id ?? remainingChannels[0]?.id ?? '__log__';
          return {
            servers, channelMap, messageMap, userMap, nickMap, statusMap, saslMap, ignoredNicks, selfAwayMap,
            selectedServerId, selectedChannelId,
          };
        }),

      addPreset: (preset) =>
        set((s) => {
          if (s.presets.some((p) => p.id === preset.id)) return {};
          return { presets: [...s.presets, preset] };
        }),

      addChannel: (serverId, channel) =>
        set((s) => {
          const existing = s.channelMap[serverId] ?? [];
          if (existing.some((c) => c.id === channel.id)) return {};
          return {
            channelMap: { ...s.channelMap, [serverId]: [...existing, channel] },
            messageMap: { ...s.messageMap, [channel.id]: s.messageMap[channel.id] ?? [] },
          };
        }),

      setTopic: (serverId, channelId, topic) =>
        set((s) => ({
          channelMap: {
            ...s.channelMap,
            [serverId]: (s.channelMap[serverId] ?? []).map((c) => (c.id === channelId ? { ...c, topic } : c)),
          },
        })),

      setTopicWhoTime: (serverId, channelId, nick, setAt) =>
        set((s) => ({
          channelMap: {
            ...s.channelMap,
            [serverId]: (s.channelMap[serverId] ?? []).map((c) =>
              c.id === channelId ? { ...c, topicSetBy: nick, topicSetAt: setAt } : c,
            ),
          },
        })),

      removeChannel: (serverId, channelId) =>
        set((s) => {
          const channels = (s.channelMap[serverId] ?? []).filter((c) => c.id !== channelId);
          const channelMap = { ...s.channelMap, [serverId]: channels };
          const messageMap = { ...s.messageMap };
          delete messageMap[channelId];
          const userMap = { ...s.userMap };
          delete userMap[channelId];

          if (s.selectedChannelId !== channelId) {
            return { channelMap, messageMap, userMap };
          }

          const logCh = channels.find((c) => c.isLog);
          const selectedChannelId = logCh?.id ?? channels[0]?.id ?? '__log__';
          return { channelMap, messageMap, userMap, selectedChannelId };
        }),

      appendMessage: (key, msg) =>
        set((s) => ({ messageMap: { ...s.messageMap, [key]: [...(s.messageMap[key] ?? []), msg] } })),

      // Seeds a channel with fetched history, prepended before anything that
      // arrived live before the fetch resolved.
      setHistory: (key, messages) =>
        set((s) => ({ messageMap: { ...s.messageMap, [key]: [...messages, ...(s.messageMap[key] ?? [])] } })),

      setUsers: (channelId, users) =>
        set((s) => ({ userMap: { ...s.userMap, [channelId]: users } })),

      addUser: (channelId, user) =>
        set((s) => {
          const existing = s.userMap[channelId] ?? [];
          if (existing.some((u) => u.nick === user.nick)) return {};
          return { userMap: { ...s.userMap, [channelId]: [...existing, user] } };
        }),

      removeUser: (channelId, nick) =>
        set((s) => ({
          userMap: { ...s.userMap, [channelId]: (s.userMap[channelId] ?? []).filter((u) => u.nick !== nick) },
        })),

      // multi-prefix (negotiated in ircclient's CAP REQ) means NAMES now reports
      // every privilege a user holds, not just the highest - so this can just
      // add/remove the specific letter a MODE change touches, exactly, instead
      // of the old single-slot heuristic (a grant only replacing what's tracked
      // if it outranked it, a revoke only clearing an exact match) that lost a
      // user's other privileges the moment one of them changed.
      applyModeChanges: (channelId, changes) =>
        set((s) => {
          const byNick = new Map<string, typeof changes>();
          for (const c of changes) byNick.set(c.nick, [...(byNick.get(c.nick) ?? []), c]);

          const users = s.userMap[channelId] ?? [];
          const updated = users.map((u) => {
            const relevant = byNick.get(u.nick);
            if (!relevant) return u;
            let privileges = u.privileges;
            for (const c of relevant) {
              privileges = c.granted
                ? privileges.includes(c.privilege) ? privileges : [...privileges, c.privilege]
                : privileges.filter((p) => p !== c.privilege);
            }
            return { ...u, privileges };
          });
          return { userMap: { ...s.userMap, [channelId]: updated } };
        }),

      removeUserEverywhere: (nick) =>
        set((s) => ({
          userMap: Object.fromEntries(
            Object.entries(s.userMap).map(([cid, users]) => [cid, users.filter((u) => u.nick !== nick)]),
          ),
        })),

      renameUserEverywhere: (oldNick, newNick) =>
        set((s) => ({
          userMap: Object.fromEntries(
            Object.entries(s.userMap).map(([cid, users]) => [
              cid,
              users.map((u) => (u.nick === oldNick ? { ...u, nick: newNick } : u)),
            ]),
          ),
        })),

      applyAwayEverywhere: (nick, away) =>
        set((s) => ({
          userMap: Object.fromEntries(
            Object.entries(s.userMap).map(([cid, users]) => [
              cid,
              users.map((u) => (u.nick === nick ? { ...u, away } : u)),
            ]),
          ),
        })),

      setNick: (serverId, nick) =>
        set((s) => ({ nickMap: { ...s.nickMap, [serverId]: nick } })),

      setSaslCreds: (serverId, user, pass) =>
        set((s) => ({ saslMap: { ...s.saslMap, [serverId]: { user, pass } } })),

      selectServer: (id) => {
        const channels = get().channelMap[id] ?? [];
        const logCh = channels.find((c) => c.isLog);
        set({ selectedServerId: id, selectedChannelId: logCh?.id ?? channels[0]?.id ?? '__log__' });
      },

      // Selecting a channel is "viewing" it, so any pending mention on it is
      // resolved - same spot JOIN's auto-select already lived, now doing
      // double duty.
      selectChannel: (id) =>
        set((s) => {
          if (!s.mentionedChannels[id]) return { selectedChannelId: id };
          const mentionedChannels = { ...s.mentionedChannels };
          delete mentionedChannels[id];
          return { selectedChannelId: id, mentionedChannels };
        }),

      setConnectionStatus: (serverId, status) =>
        set((s) => ({ statusMap: { ...s.statusMap, [serverId]: status } })),

      setSelfAway: (serverId, away) =>
        set((s) => ({ selfAwayMap: { ...s.selfAwayMap, [serverId]: away } })),

      markMentioned: (channelId) =>
        set((s) => ({ mentionedChannels: { ...s.mentionedChannels, [channelId]: true } })),

      toggleMuteChannel: (channelId) =>
        set((s) => {
          const mutedChannels = { ...s.mutedChannels };
          if (mutedChannels[channelId]) {
            delete mutedChannels[channelId];
          } else {
            mutedChannels[channelId] = true;
          }
          return { mutedChannels };
        }),

      setNotificationsEnabled: (enabled) => set({ notificationsEnabled: enabled }),

      setTimestampFormat: (format) => set({ timestampFormat: format }),

      setMessageDensity: (density) => set({ messageDensity: density }),

      addIgnore: (serverId, nick) =>
        set((s) => {
          const existing = s.ignoredNicks[serverId] ?? [];
          if (existing.includes(nick)) return {};
          return { ignoredNicks: { ...s.ignoredNicks, [serverId]: [...existing, nick] } };
        }),

      removeIgnore: (serverId, nick) =>
        set((s) => ({
          ignoredNicks: { ...s.ignoredNicks, [serverId]: (s.ignoredNicks[serverId] ?? []).filter((n) => n !== nick) },
        })),

      setAlias: (name, template) =>
        set((s) => ({ aliases: { ...s.aliases, [name]: template } })),

      removeAlias: (name) =>
        set((s) => {
          const aliases = { ...s.aliases };
          delete aliases[name];
          return { aliases };
        }),
    }),
    {
      name: 'dolq',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        servers: s.servers,
        presets: s.presets,
        channelMap: s.channelMap,
        userMap: s.userMap,
        nickMap: s.nickMap,
        selectedServerId: s.selectedServerId,
        selectedChannelId: s.selectedChannelId,
        notificationsEnabled: s.notificationsEnabled,
        mutedChannels: s.mutedChannels,
        timestampFormat: s.timestampFormat,
        messageDensity: s.messageDensity,
        ignoredNicks: s.ignoredNicks,
        aliases: s.aliases,
      }),
    },
  ),
);
