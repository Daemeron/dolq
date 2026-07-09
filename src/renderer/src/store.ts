import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  MOCK_SERVERS, MOCK_CHANNELS, MOCK_MESSAGES, MOCK_USERS,
  type Server, type Channel, type Message, type User,
} from './DummyData';

type State = {
  servers: Server[];
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
  addChannel: (serverId: string, channel: Channel) => void;
  appendMessage: (key: string, msg: Message) => void;
  setUsers: (channelId: string, users: User[]) => void;
  addUser: (channelId: string, user: User) => void;
  removeUser: (channelId: string, nick: string) => void;
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
      servers: MOCK_SERVERS,
      channelMap: MOCK_CHANNELS,
      messageMap: MOCK_MESSAGES,
      userMap: MOCK_USERS,
      nickMap: { libera: 'reecord_user', ircnet: 'reecord_user' },
      selectedServerId: MOCK_SERVERS[0].id,
      selectedChannelId: '__log__',
      statusMap: {},

      addServer: (server, logChannel) =>
        set((s) => ({
          servers: [...s.servers, server],
          channelMap: { ...s.channelMap, [server.id]: [logChannel] },
          messageMap: { ...s.messageMap, [logChannel.id]: [] },
        })),

      addChannel: (serverId, channel) =>
        set((s) => {
          const existing = s.channelMap[serverId] ?? [];
          if (existing.some((c) => c.id === channel.id)) return {};
          return {
            channelMap: { ...s.channelMap, [serverId]: [...existing, channel] },
            messageMap: { ...s.messageMap, [channel.id]: s.messageMap[channel.id] ?? [] },
          };
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
      name: 'reecord',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        servers: s.servers,
        channelMap: s.channelMap,
        nickMap: s.nickMap,
        selectedServerId: s.selectedServerId,
        selectedChannelId: s.selectedChannelId
      }),
    },
  ),
);
