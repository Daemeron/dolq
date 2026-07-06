import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  MOCK_SERVERS, MOCK_CHANNELS, MOCK_MESSAGES,
  type Server, type Channel, type Message,
} from './DummyData';

type State = {
  servers: Server[];
  channelMap: Record<string, Channel[]>;
  messageMap: Record<string, Message[]>;
  nickMap: Record<string, string>;
  selectedServerId: string;
  selectedChannelId: string;
};

type Actions = {
  addServer: (server: Server, logChannel: Channel) => void;
  appendMessage: (key: string, msg: Message) => void;
  setNick: (serverId: string, nick: string) => void;
  selectServer: (id: string) => void;
  selectChannel: (id: string) => void;
};

export const useStore = create<State & Actions>()(
  persist(
    (set, get) => ({
      servers: MOCK_SERVERS,
      channelMap: MOCK_CHANNELS,
      messageMap: MOCK_MESSAGES,
      nickMap: { libera: 'reecord_user', ircnet: 'reecord_user' },
      selectedServerId: MOCK_SERVERS[0].id,
      selectedChannelId: '__log__',

      addServer: (server, logChannel) =>
        set((s) => ({
          servers: [...s.servers, server],
          channelMap: { ...s.channelMap, [server.id]: [logChannel] },
          messageMap: { ...s.messageMap, [logChannel.id]: [] },
        })),

      appendMessage: (key, msg) =>
        set((s) => ({ messageMap: { ...s.messageMap, [key]: [...(s.messageMap[key] ?? []), msg] } })),

      setNick: (serverId, nick) =>
        set((s) => ({ nickMap: { ...s.nickMap, [serverId]: nick } })),

      selectServer: (id) => {
        const channels = get().channelMap[id] ?? [];
        const logCh = channels.find((c) => c.isLog);
        set({ selectedServerId: id, selectedChannelId: logCh?.id ?? channels[0]?.id ?? '__log__' });
      },

      selectChannel: (id) => set({ selectedChannelId: id }),
    }),
    {
      name: 'reecord',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({
        servers: s.servers,
        channelMap: s.channelMap,
        nickMap: s.nickMap,
        selectedServerId: s.selectedServerId,
        selectedChannelId: s.selectedChannelId,
      }),
    },
  ),
);
