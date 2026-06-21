import { Channel, User } from '../types';
import { useContextMenu } from '../useContextMenu';
import { ContextMenu, ContextMenuHeader, ContextMenuItem } from './ContextMenu';

type Props = {
  serverName: string;
  channels: Channel[];
  selectedId: string;
  onSelect: (id: string) => void;
  currentNick: string;
  userMap: Record<string, User[]>;
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  onConnect: () => void;
  onDisconnect: () => void;
  onJoinChannel: (id: string) => void;
  onLeaveChannel: (id: string) => void;
  onRemoveChannel: (id: string) => void;
};

export function ChannelList({
  serverName, channels, selectedId, onSelect, currentNick, userMap, connectionStatus, onConnect, onDisconnect,
  onJoinChannel, onLeaveChannel, onRemoveChannel,
}: Props) {
  const btnColor = connectionStatus === 'connected'
    ? 'bg-[#3ba55d] hover:bg-[#ed4245]'
    : connectionStatus === 'connecting'
    ? 'bg-[#72767d] cursor-not-allowed'
    : 'bg-[#72767d] hover:bg-[#3ba55d]';
  const logChannel = channels.find((c) => c.isLog);
  const regularChannels = channels.filter((c) => !c.isLog);
  const { menu, open, close, dismissIfUnhandled } = useContextMenu<string>();
  const menuChannel = regularChannels.find((c) => c.id === menu?.target);
  const menuChannelJoined = !!menuChannel && (userMap[menuChannel.id] ?? []).some((u) => u.nick === currentNick);

  return (
    <aside
      className="relative flex flex-col w-60 bg-[#2f3136] shrink-0 overflow-hidden"
      onContextMenu={dismissIfUnhandled}
    >
      <div className="px-4 h-12 flex items-center font-bold text-[15px] text-white border-b border-[#26282d] shrink-0 shadow-[0_1px_0_rgba(0,0,0,0.2)]">
        {serverName}
      </div>

      {logChannel && (
        <div className="pt-3 pb-1 px-2">
          <button
            onClick={() => onSelect(logChannel.id)}
            className={`flex items-center gap-2 w-full py-1.5 px-2 rounded border-0 text-[14px] cursor-pointer text-left font-medium transition-[background,color] duration-100 ${
              selectedId === logChannel.id
                ? 'bg-[rgba(79,84,92,0.6)] text-white'
                : 'bg-transparent text-[#8e9297] hover:bg-[rgba(79,84,92,0.4)] hover:text-[#dcddde]'
            }`}
          >
            <span className="font-mono text-[11px] opacity-60">▤</span>
            Log
          </button>
        </div>
      )}

      <div className="pt-3 pb-1 px-4 text-[11px] font-bold uppercase tracking-[0.5px] text-[#72767d]">
        Text Channels
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {regularChannels.map((ch) => (
          <button
            key={ch.id}
            onClick={() => onSelect(ch.id)}
            onContextMenu={(e) => open(ch.id, e)}
            className={`flex items-center w-full py-1.5 px-2 my-px rounded border-0 text-[15px] cursor-pointer text-left transition-[background,color] duration-100 ${
              ch.id === selectedId
                ? 'bg-[rgba(79,84,92,0.6)] text-white'
                : 'bg-transparent text-[#8e9297] hover:bg-[rgba(79,84,92,0.4)] hover:text-[#dcddde]'
            }`}
          >
            <span className="text-[16px] mr-1.5 opacity-50">#</span>
            {ch.name}
          </button>
        ))}
      </div>

      <div className="px-2 pb-2 shrink-0">
        <button
          onClick={connectionStatus === 'connecting' ? undefined : connectionStatus === 'connected' ? onDisconnect : onConnect}
          disabled={connectionStatus === 'connecting'}
          className={`group w-full py-2 rounded text-sm font-medium text-white transition-colors ${btnColor}`}
        >
          {connectionStatus === 'connecting' ? 'Connecting…' : connectionStatus === 'connected' ? (
            <>
              <span className="group-hover:hidden">Connected</span>
              <span className="hidden group-hover:inline">Disconnect</span>
            </>
          ) : (
            <>
              <span className="group-hover:hidden">Disconnected</span>
              <span className="hidden group-hover:inline">Connect</span>
            </>
          )}
        </button>
      </div>

      <div className="flex items-center gap-2 p-2 bg-[#292b2f] shrink-0">
        <div className="w-8 h-8 rounded-full bg-[#7289da] text-white flex items-center justify-center font-bold text-sm shrink-0">
          {currentNick[0]?.toUpperCase() ?? '?'}
        </div>
        <span className="text-[13px] font-semibold text-white truncate">{currentNick}</span>
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
    </aside>
  );
}
