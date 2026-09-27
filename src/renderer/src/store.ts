import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { PrivilegeLevel } from '../../shared/ipc';
import { PUBLIC_SERVERS, type ServerPreset } from './data/servers';
import type { Channel, Message, Server, User } from './types';

type State = {
  servers: Server[];
  presets: ServerPreset[];
  channelMap: Record<string, Channel[]>;
  messageMap: Record<string, Message[]>;
  userMap: Record<string, User[]>;
  nickMap: Record<string, string>;
  selectedServerId: string;
  selectedChannelId: string;
  lastChannelMap: Record<string, string>;
  statusMap: Record<string, 'disconnected' | 'connecting' | 'connected'>;
  saslMap: Record<string, { user: string; pass: string }>;
  mentionedChannels: Record<string, boolean>;
  notificationsEnabled: boolean;
  soundAlertsEnabled: boolean;
  mutedChannels: Record<string, boolean>;
  lastReadMap: Record<string, number>;
  timestampFormat: '12h' | '24h';
  messageDensity: 'cozy' | 'compact';
  fontSize: 'small' | 'medium' | 'large';
  fontFamily: 'system' | 'serif' | 'monospace';
  theme: 'dark' | 'light';
  ignoredNicks: Record<string, string[]>;
  selfAwayMap: Record<string, boolean>;
  aliases: Record<string, string>;
  keybindings: Record<KeybindAction, string>;
};

export function scopeKey(serverId: string, channelId: string): string {
  return channelId.includes(':') ? channelId : `${serverId}:${channelId}`;
}

export type KeybindAction = 'nextChannel' | 'prevChannel' | 'closeChannel' | 'toggleMute';

export const DEFAULT_KEYBINDINGS: Record<KeybindAction, string> = {
  nextChannel: 'Alt+ArrowDown',
  prevChannel: 'Alt+ArrowUp',
  closeChannel: 'Alt+W',
  toggleMute: 'Alt+M',
};

type Actions = {
  addServer: (server: Server, logChannel: Channel) => void;
  removeServer: (id: string) => void;
  addPreset: (preset: ServerPreset) => void;
  addChannel: (serverId: string, channel: Channel) => void;
  removeChannel: (serverId: string, channelId: string) => void;
  setChannelJoined: (serverId: string, channelId: string, joined: boolean) => void;
  setTopic: (serverId: string, channelId: string, topic: string) => void;
  setTopicWhoTime: (serverId: string, channelId: string, nick: string, setAt: Date) => void;
  appendMessage: (key: string, msg: Message) => void;
  setHistory: (key: string, messages: Message[]) => void;
  setUsers: (channelId: string, users: User[]) => void;
  addUser: (channelId: string, user: User) => void;
  removeUser: (channelId: string, nick: string) => void;
  applyModeChanges: (
    channelId: string,
    changes: { nick: string; privilege: Exclude<PrivilegeLevel, 'none'>; granted: boolean }[],
  ) => void;
  removeUserEverywhere: (nick: string) => void;
  renameUserEverywhere: (oldNick: string, newNick: string) => void;
  setNick: (serverId: string, nick: string) => void;
  setSaslCreds: (serverId: string, user: string, pass: string) => void;
  selectServer: (id: string) => void;
  selectChannel: (id: string) => void;
  setConnectionStatus: (serverId: string, status: 'disconnected' | 'connecting' | 'connected') => void;
  markMentioned: (channelId: string) => void;
  markRead: (key: string) => void;
  toggleMuteChannel: (channelId: string) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setSoundAlertsEnabled: (enabled: boolean) => void;
  setTimestampFormat: (format: '12h' | '24h') => void;
  setMessageDensity: (density: 'cozy' | 'compact') => void;
  setFontSize: (size: 'small' | 'medium' | 'large') => void;
  setFontFamily: (family: 'system' | 'serif' | 'monospace') => void;
  setTheme: (theme: 'dark' | 'light') => void;
  addIgnore: (serverId: string, nick: string) => void;
  removeIgnore: (serverId: string, nick: string) => void;
  applyAwayEverywhere: (nick: string, away: boolean) => void;
  setSelfAway: (serverId: string, away: boolean) => void;
  setAlias: (name: string, template: string) => void;
  removeAlias: (name: string) => void;
  setKeybinding: (action: KeybindAction, combo: string) => void;
  setServerColor: (id: string, color: string) => void;
  updateServer: (id: string, patch: Partial<Server>) => void;
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
      lastChannelMap: {},
      statusMap: {},
      saslMap: {},
      mentionedChannels: {},
      lastReadMap: {},
      notificationsEnabled: true,
      soundAlertsEnabled: true,
      mutedChannels: {},
      timestampFormat: '12h',
      messageDensity: 'cozy',
      fontSize: 'medium',
      fontFamily: 'system',
      theme: 'dark',
      ignoredNicks: {},
      selfAwayMap: {},
      aliases: {},
      keybindings: DEFAULT_KEYBINDINGS,

      addServer: (server, logChannel) =>
        set((s) => ({
          servers: [...s.servers, server],
          channelMap: { ...s.channelMap, [server.id]: [logChannel] },
          messageMap: { ...s.messageMap, [scopeKey(server.id, logChannel.id)]: [] },
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
            delete messageMap[scopeKey(id, cid)];
            delete userMap[scopeKey(id, cid)];
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
          const lastChannelMap = { ...s.lastChannelMap };
          delete lastChannelMap[id];

          if (s.selectedServerId !== id) {
            return {
              servers,
              channelMap,
              messageMap,
              userMap,
              nickMap,
              statusMap,
              saslMap,
              ignoredNicks,
              selfAwayMap,
              lastChannelMap,
            };
          }

          const selectedServerId = servers[0]?.id ?? '';
          const remainingChannels = channelMap[selectedServerId] ?? [];
          const logCh = remainingChannels.find((c) => c.isLog);
          const selectedChannelId = logCh?.id ?? remainingChannels[0]?.id ?? '__log__';
          return {
            servers,
            channelMap,
            messageMap,
            userMap,
            nickMap,
            statusMap,
            saslMap,
            ignoredNicks,
            selfAwayMap,
            lastChannelMap,
            selectedServerId,
            selectedChannelId,
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
          const key = scopeKey(serverId, channel.id);
          return {
            channelMap: { ...s.channelMap, [serverId]: [...existing, channel] },
            messageMap: { ...s.messageMap, [key]: s.messageMap[key] ?? [] },
          };
        }),

      setChannelJoined: (serverId, channelId, joined) =>
        set((s) => ({
          channelMap: {
            ...s.channelMap,
            [serverId]: (s.channelMap[serverId] ?? []).map((c) => (c.id === channelId ? { ...c, joined } : c)),
          },
        })),

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
          delete messageMap[scopeKey(serverId, channelId)];
          const userMap = { ...s.userMap };
          delete userMap[scopeKey(serverId, channelId)];

          if (s.selectedChannelId !== channelId) {
            return { channelMap, messageMap, userMap };
          }

          const logCh = channels.find((c) => c.isLog);
          const selectedChannelId = logCh?.id ?? channels[0]?.id ?? '__log__';
          return { channelMap, messageMap, userMap, selectedChannelId };
        }),

      appendMessage: (key, msg) =>
        set((s) => ({ messageMap: { ...s.messageMap, [key]: [...(s.messageMap[key] ?? []), msg] } })),

      setHistory: (key, messages) =>
        set((s) => ({ messageMap: { ...s.messageMap, [key]: [...messages, ...(s.messageMap[key] ?? [])] } })),

      setUsers: (channelId, users) => set((s) => ({ userMap: { ...s.userMap, [channelId]: users } })),

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
                ? privileges.includes(c.privilege)
                  ? privileges
                  : [...privileges, c.privilege]
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

      setNick: (serverId, nick) => set((s) => ({ nickMap: { ...s.nickMap, [serverId]: nick } })),

      setSaslCreds: (serverId, user, pass) => set((s) => ({ saslMap: { ...s.saslMap, [serverId]: { user, pass } } })),

      selectServer: (id) => {
        const channels = get().channelMap[id] ?? [];
        const lastChannelId = get().lastChannelMap[id];
        const lastStillExists = channels.some((c) => c.id === lastChannelId);
        const logCh = channels.find((c) => c.isLog);
        set({
          selectedServerId: id,
          selectedChannelId: lastStillExists ? lastChannelId : (logCh?.id ?? channels[0]?.id ?? '__log__'),
        });
      },

      selectChannel: (id) =>
        set((s) => {
          const lastChannelMap = { ...s.lastChannelMap, [s.selectedServerId]: id };
          if (!s.mentionedChannels[id]) return { selectedChannelId: id, lastChannelMap };
          const mentionedChannels = { ...s.mentionedChannels };
          delete mentionedChannels[id];
          return { selectedChannelId: id, lastChannelMap, mentionedChannels };
        }),

      setConnectionStatus: (serverId, status) => set((s) => ({ statusMap: { ...s.statusMap, [serverId]: status } })),

      setSelfAway: (serverId, away) => set((s) => ({ selfAwayMap: { ...s.selfAwayMap, [serverId]: away } })),

      markMentioned: (channelId) => set((s) => ({ mentionedChannels: { ...s.mentionedChannels, [channelId]: true } })),

      markRead: (key) => set((s) => ({ lastReadMap: { ...s.lastReadMap, [key]: Date.now() } })),

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

      setSoundAlertsEnabled: (enabled) => set({ soundAlertsEnabled: enabled }),

      setTimestampFormat: (format) => set({ timestampFormat: format }),

      setMessageDensity: (density) => set({ messageDensity: density }),

      setFontSize: (size) => set({ fontSize: size }),

      setFontFamily: (family) => set({ fontFamily: family }),

      setTheme: (theme) => set({ theme }),

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

      setAlias: (name, template) => set((s) => ({ aliases: { ...s.aliases, [name]: template } })),

      removeAlias: (name) =>
        set((s) => {
          const aliases = { ...s.aliases };
          delete aliases[name];
          return { aliases };
        }),

      setKeybinding: (action, combo) => set((s) => ({ keybindings: { ...s.keybindings, [action]: combo } })),

      setServerColor: (id, color) => get().updateServer(id, { color }),

      updateServer: (id, patch) =>
        set((s) => ({ servers: s.servers.map((sv) => (sv.id === id ? { ...sv, ...patch } : sv)) })),
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
        lastChannelMap: s.lastChannelMap,
        notificationsEnabled: s.notificationsEnabled,
        soundAlertsEnabled: s.soundAlertsEnabled,
        mutedChannels: s.mutedChannels,
        lastReadMap: s.lastReadMap,
        timestampFormat: s.timestampFormat,
        messageDensity: s.messageDensity,
        fontSize: s.fontSize,
        fontFamily: s.fontFamily,
        theme: s.theme,
        ignoredNicks: s.ignoredNicks,
        aliases: s.aliases,
        keybindings: s.keybindings,
      }),
    },
  ),
);
