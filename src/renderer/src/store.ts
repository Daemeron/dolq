import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { type Server, type Channel, type Message, type User } from './types';
import { PUBLIC_SERVERS, type ServerPreset } from './data/servers';
import { outranks, type PrivilegeLevel } from '../../shared/ipc';

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
};

type Actions = {
  addServer: (server: Server, logChannel: Channel) => void;
  removeServer: (id: string) => void;
  addPreset: (preset: ServerPreset) => void;
  addChannel: (serverId: string, channel: Channel) => void;
  removeChannel: (serverId: string, channelId: string) => void;
  appendMessage: (key: string, msg: Message) => void;
  setUsers: (channelId: string, users: User[]) => void;
  addUser: (channelId: string, user: User) => void;
  removeUser: (channelId: string, nick: string) => void;
  applyModeChanges: (channelId: string, changes: { nick: string; privilege: Exclude<PrivilegeLevel, 'none'>; granted: boolean }[]) => void;
  removeUserEverywhere: (nick: string) => void;
  renameUserEverywhere: (oldNick: string, newNick: string) => void;
  setNick: (serverId: string, nick: string) => void;
  selectServer: (id: string) => void;
  selectChannel: (id: string) => void;
  setConnectionStatus: (serverId: string, status: 'disconnected' | 'connecting' | 'connected') => void;
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

          if (s.selectedServerId !== id) {
            return { servers, channelMap, messageMap, userMap, nickMap, statusMap };
          }

          const selectedServerId = servers[0]?.id ?? '';
          const remainingChannels = channelMap[selectedServerId] ?? [];
          const logCh = remainingChannels.find((c) => c.isLog);
          const selectedChannelId = logCh?.id ?? remainingChannels[0]?.id ?? '__log__';
          return { servers, channelMap, messageMap, userMap, nickMap, statusMap, selectedServerId, selectedChannelId };
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

      // without negotiating the multi-prefix capability, NAMES/MODE only ever
      // reveal a user's single highest privilege, not the full set they hold. So a grant
      // only takes effect if it outranks what's tracked, and a revoke only clears the
      // tracked privilege if it matches exactly - upgrade path is CAP REQ multi-prefix.
      applyModeChanges: (channelId, changes) =>
        set((s) => {
          const users = s.userMap[channelId] ?? [];
          const latestByNick = new Map(changes.map((c) => [c.nick, c]));
          const updated = users.map((u) => {
            const change = latestByNick.get(u.nick);
            if (!change) return u;
            if (change.granted) {
              return outranks(change.privilege, u.privilege) ? { ...u, privilege: change.privilege } : u;
            }
            return u.privilege === change.privilege ? { ...u, privilege: 'none' as const } : u;
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

      setNick: (serverId, nick) =>
        set((s) => ({ nickMap: { ...s.nickMap, [serverId]: nick } })),

      selectServer: (id) => {
        const channels = get().channelMap[id] ?? [];
        const logCh = channels.find((c) => c.isLog);
        set({ selectedServerId: id, selectedChannelId: logCh?.id ?? channels[0]?.id ?? '__log__' });
      },

      selectChannel: (id) => set({ selectedChannelId: id }),

      setConnectionStatus: (serverId, status) =>
        set((s) => ({ statusMap: { ...s.statusMap, [serverId]: status } })),
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
        selectedChannelId: s.selectedChannelId
      }),
    },
  ),
);
