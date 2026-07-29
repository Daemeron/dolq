import { Channel, User } from '../types';
import { useContextMenu } from '../hooks/useContextMenu';
import { ContextMenu, ContextMenuHeader, ContextMenuItem } from './ContextMenu';

type Props = {
  serverName: string;
  channels: Channel[];
  selectedId: string;
  onSelect: (id: string) => void;
  currentNick: string;
  userMap: Record<string, User[]>;
  mentionedChannels: Record<string, boolean>;
  onJoinChannel: (id: string) => void;
  onLeaveChannel: (id: string) => void;
  onRemoveChannel: (id: string) => void;
  onCloseQuery: (id: string) => void;
};

export function ChannelList({
  serverName, channels, selectedId, onSelect, currentNick, userMap, mentionedChannels,
  onJoinChannel, onLeaveChannel, onRemoveChannel, onCloseQuery,
}: Props) {
  const logChannel = channels.find((c) => c.isLog);
  const regularChannels = channels.filter((c) => !c.isLog && !c.isQuery);
  // isDCC implies isQuery (see types.ts) - queries stays the full set for
  // context-menu lookup/Close below, plainQueries/dccChats just split it
  // for rendering into their own sidebar sections.
  const queries = channels.filter((c) => c.isQuery);
  const plainQueries = queries.filter((c) => !c.isDCC);
  const dccChats = queries.filter((c) => c.isDCC);
  const { menu, open, close, dismissIfUnhandled } = useContextMenu<string>();
  const menuChannel = regularChannels.find((c) => c.id === menu?.target);
  const menuChannelJoined = !!menuChannel && (userMap[menuChannel.id] ?? []).some((u) => u.nick === currentNick);
  const menuQuery = queries.find((c) => c.id === menu?.target);

  return (
    <aside
      className="relative flex flex-col w-60 bg-[#1c1c1c] shrink-0 overflow-hidden"
      onContextMenu={dismissIfUnhandled}
    >
      <div className="px-4 h-12 flex items-center font-bold text-[15px] text-white border-b border-[#2a2a2a] shrink-0 shadow-[0_1px_0_rgba(0,0,0,0.2)]">
        {serverName}
      </div>

      {logChannel && (
        <div className="pt-3 pb-1 px-2">
          <button
            onClick={() => onSelect(logChannel.id)}
            className={`flex items-center gap-2 w-full py-1.5 px-2 rounded border-0 text-[14px] cursor-pointer text-left font-medium transition-[background,color] duration-100 ${
              selectedId === logChannel.id
                ? 'bg-[rgba(90,90,90,0.55)] text-white'
                : 'bg-transparent text-[#909090] hover:bg-[rgba(90,90,90,0.35)] hover:text-[#e6e6e6]'
            }`}
          >
            <span className="font-mono text-[11px] opacity-60">▤</span>
            Log
          </button>
        </div>
      )}

      <div className="pt-3 pb-1 px-4 text-[11px] font-bold uppercase tracking-[0.5px] text-[#6b6b6b]">
        Text Channels
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 scroll-thin mb-30">
        {regularChannels.map((ch) => {
          const joined = (userMap[ch.id] ?? []).some((u) => u.nick === currentNick);
          const mentioned = !!mentionedChannels[ch.id];
          return (
            <button
              key={ch.id}
              onClick={() => onSelect(ch.id)}
              onContextMenu={(e) => open(ch.id, e)}
              title={joined ? undefined : 'Not currently in this channel'}
              className={`flex items-center w-full py-1.5 px-2 my-px rounded border-0 text-[15px] cursor-pointer text-left transition-[background,color] duration-100 ${
                ch.id === selectedId
                  ? 'bg-[rgba(90,90,90,0.55)] text-white'
                  : mentioned
                  ? 'bg-transparent text-[#ffcb6b] font-semibold hover:bg-[rgba(90,90,90,0.35)]'
                  : 'bg-transparent text-[#909090] hover:bg-[rgba(90,90,90,0.35)] hover:text-[#e6e6e6]'
              } ${joined ? '' : 'opacity-50 italic'}`}
            >
              <span className="text-[16px] mr-1.5 opacity-50">#</span>
              <span className="flex-1 truncate">{ch.name}</span>
              {mentioned && <span className="w-2 h-2 rounded-full bg-[#ffcb6b] shrink-0" />}
            </button>
          );
        })}

        {plainQueries.length > 0 && (
          <div className="pt-3 pb-1 px-2 text-[11px] font-bold uppercase tracking-[0.5px] text-[#6b6b6b]">
            Direct Messages
          </div>
        )}
        {plainQueries.map((ch) => (
          <button
            key={ch.id}
            onClick={() => onSelect(ch.id)}
            onContextMenu={(e) => open(ch.id, e)}
            className={`flex items-center w-full py-1.5 px-2 my-px rounded border-0 text-[15px] cursor-pointer text-left transition-[background,color] duration-100 ${
              ch.id === selectedId
                ? 'bg-[rgba(90,90,90,0.55)] text-white'
                : 'bg-transparent text-[#909090] hover:bg-[rgba(90,90,90,0.35)] hover:text-[#e6e6e6]'
            }`}
          >
            <span className="text-[16px] mr-1.5 opacity-50">@</span>
            {ch.name}
          </button>
        ))}

        {dccChats.length > 0 && (
          <div className="pt-3 pb-1 px-2 text-[11px] font-bold uppercase tracking-[0.5px] text-[#6b6b6b]">
            DCC Chats
          </div>
        )}
        {dccChats.map((ch) => (
          <button
            key={ch.id}
            onClick={() => onSelect(ch.id)}
            onContextMenu={(e) => open(ch.id, e)}
            className={`flex items-center w-full py-1.5 px-2 my-px rounded border-0 text-[15px] cursor-pointer text-left transition-[background,color] duration-100 ${
              ch.id === selectedId
                ? 'bg-[rgba(90,90,90,0.55)] text-white'
                : 'bg-transparent text-[#909090] hover:bg-[rgba(90,90,90,0.35)] hover:text-[#e6e6e6]'
            }`}
          >
            <span className="text-[16px] mr-1.5 opacity-50">⚡</span>
            {ch.name}
          </button>
        ))}
      </div>

      {menu && menuChannel && (
        <ContextMenu x={menu.x} y={menu.y}>
          <ContextMenuHeader>#{menuChannel.name}</ContextMenuHeader>
          {menuChannelJoined ? (
            <ContextMenuItem onClick={() => { onLeaveChannel(menuChannel.id); close(); }}>
              Leave Channel
            </ContextMenuItem>
          ) : (
            <ContextMenuItem onClick={() => { onJoinChannel(menuChannel.id); close(); }}>
              Join Channel
            </ContextMenuItem>
          )}
          <ContextMenuItem danger onClick={() => { onRemoveChannel(menuChannel.id); close(); }}>
            Remove Channel
          </ContextMenuItem>
        </ContextMenu>
      )}

      {menu && menuQuery && (
        <ContextMenu x={menu.x} y={menu.y}>
          <ContextMenuHeader>{menuQuery.name}</ContextMenuHeader>
          <ContextMenuItem danger onClick={() => { onCloseQuery(menuQuery.id); close(); }}>
            Close
          </ContextMenuItem>
        </ContextMenu>
      )}
    </aside>
  );
}
