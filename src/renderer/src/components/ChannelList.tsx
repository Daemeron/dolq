import { useContextMenu } from '../hooks/useContextMenu';
import type { Channel } from '../types';
import { nickColor, nickInitial } from '../utils/nickColor';
import { ContextMenu, ContextMenuHeader, ContextMenuItem } from './ContextMenu';
import { Icon } from './Icon';

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="pt-3.5 pb-1.5 px-4 text-[12px] font-medium text-(--dolq-text-dim)">{children}</div>;
}

export function RowButton({
  selected,
  strong,
  dimmed,
  children,
  ...rest
}: {
  selected: boolean;
  strong?: boolean;
  dimmed?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`flex items-center gap-2.5 h-8 mx-2 w-[calc(100%-16px)] px-2 rounded-lg border-0 text-[14px] cursor-pointer text-left transition-colors ${
        selected
          ? 'bg-(--dolq-bg-row-selected) text-(--dolq-text) font-medium'
          : `bg-transparent hover:bg-(--dolq-bg-row-hover) ${strong ? 'text-(--dolq-text) font-semibold' : 'text-(--dolq-text-muted)'}`
      } ${dimmed ? 'opacity-45 italic' : ''}`}
    >
      {children}
    </button>
  );
}

type Props = {
  serverName: string;
  channels: Channel[];
  selectedId: string;
  onSelect: (id: string) => void;
  mentionedChannels: Record<string, boolean>;
  awayStats: Record<string, { count: number; people: number }>;
  mutedChannels: Record<string, boolean>;
  onToggleMuteChannel: (id: string) => void;
  onJoinChannel: (id: string) => void;
  onLeaveChannel: (id: string) => void;
  onRemoveChannel: (id: string) => void;
  onCloseQuery: (id: string) => void;
};

export function ChannelList({
  serverName,
  channels,
  selectedId,
  onSelect,
  mentionedChannels,
  awayStats,
  mutedChannels,
  onToggleMuteChannel,
  onJoinChannel,
  onLeaveChannel,
  onRemoveChannel,
  onCloseQuery,
}: Props) {
  const logChannel = channels.find((c) => c.isLog);
  const regularChannels = channels.filter((c) => !c.isLog && !c.isQuery);
  const queries = channels.filter((c) => c.isQuery);
  const plainQueries = queries.filter((c) => !c.isDCC);
  const dccChats = queries.filter((c) => c.isDCC);
  const { menu, open, close, dismissIfUnhandled } = useContextMenu<string>();
  const menuChannel = regularChannels.find((c) => c.id === menu?.target);
  const menuChannelJoined = menuChannel?.joined === true;
  const menuQuery = queries.find((c) => c.id === menu?.target);

  return (
    <aside
      className="relative flex flex-col flex-1 min-h-0 w-62 bg-(--dolq-bg-panel) border-r border-(--dolq-border) shrink-0 overflow-hidden"
      onContextMenu={dismissIfUnhandled}
    >
      <div className="px-4 h-14 flex items-center justify-between shrink-0">
        <span className="font-semibold text-[15px] text-(--dolq-text) truncate">{serverName}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pb-3">
        {logChannel && (
          <RowButton selected={selectedId === logChannel.id} onClick={() => onSelect(logChannel.id)}>
            <span className="w-4 flex justify-center text-(--dolq-text-faint)">
              <Icon name="terminal" size={15} />
            </span>
            <span className="flex-1 truncate">Server log</span>
          </RowButton>
        )}

        <GroupLabel>Channels</GroupLabel>
        {regularChannels.map((ch) => {
          const joined = ch.joined === true;
          const mentioned = !!mentionedChannels[ch.id];
          const muted = !!mutedChannels[ch.id];
          const away = awayStats[ch.id];
          return (
            <RowButton
              key={ch.id}
              selected={ch.id === selectedId}
              strong={mentioned || !!away}
              dimmed={!joined}
              onClick={() => onSelect(ch.id)}
              onContextMenu={(e) => open(ch.id, e)}
              title={joined ? undefined : 'Not currently in this channel'}
            >
              <span className="w-4 text-center font-medium text-(--dolq-text-faint)">#</span>
              <span className="flex-1 truncate">{ch.name}</span>
              {!joined && <span className="text-[10px] uppercase shrink-0">not joined</span>}
              {muted && (
                <span className="shrink-0 opacity-60" title="Muted">
                  <Icon name="bellOff" size={13} />
                </span>
              )}
              {away && (
                <span
                  title={`${away.count} message${away.count === 1 ? '' : 's'} from ${away.people} ${away.people === 1 ? 'person' : 'people'} since you last looked`}
                  className={`min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold inline-flex items-center justify-center shrink-0 ${
                    mentioned
                      ? 'bg-(--dolq-brand) text-(--dolq-on-brand)'
                      : 'bg-(--dolq-bg-row-selected) text-(--dolq-text-muted)'
                  }`}
                >
                  {away.count > 99 ? '99+' : away.count}
                </span>
              )}
              {mentioned && !away && <span className="w-2 h-2 rounded-full bg-(--dolq-brand) shrink-0" />}
            </RowButton>
          );
        })}

        {plainQueries.length > 0 && <GroupLabel>Direct messages</GroupLabel>}
        {plainQueries.map((ch) => (
          <RowButton
            key={ch.id}
            selected={ch.id === selectedId}
            onClick={() => onSelect(ch.id)}
            onContextMenu={(e) => open(ch.id, e)}
          >
            <span
              className="w-5 h-5 rounded-full text-white text-[10px] font-semibold flex items-center justify-center shrink-0"
              style={{ background: nickColor(ch.name) }}
            >
              {nickInitial(ch.name)}
            </span>
            <span className="flex-1 truncate">{ch.name}</span>
          </RowButton>
        ))}

        {dccChats.length > 0 && <GroupLabel>DCC chats</GroupLabel>}
        {dccChats.map((ch) => (
          <RowButton
            key={ch.id}
            selected={ch.id === selectedId}
            onClick={() => onSelect(ch.id)}
            onContextMenu={(e) => open(ch.id, e)}
          >
            <span className="w-4 flex justify-center text-(--dolq-text-faint)">
              <Icon name="zap" size={15} />
            </span>
            <span className="flex-1 truncate">{ch.name}</span>
          </RowButton>
        ))}
      </div>

      {menu && menuChannel && (
        <ContextMenu x={menu.x} y={menu.y}>
          <ContextMenuHeader>#{menuChannel.name}</ContextMenuHeader>
          {menuChannelJoined ? (
            <ContextMenuItem
              onClick={() => {
                onLeaveChannel(menuChannel.id);
                close();
              }}
            >
              Leave Channel
            </ContextMenuItem>
          ) : (
            <ContextMenuItem
              onClick={() => {
                onJoinChannel(menuChannel.id);
                close();
              }}
            >
              Join Channel
            </ContextMenuItem>
          )}
          <ContextMenuItem
            onClick={() => {
              onToggleMuteChannel(menuChannel.id);
              close();
            }}
          >
            {mutedChannels[menuChannel.id] ? 'Unmute Channel' : 'Mute Channel'}
          </ContextMenuItem>
          <ContextMenuItem
            danger
            onClick={() => {
              onRemoveChannel(menuChannel.id);
              close();
            }}
          >
            Remove Channel
          </ContextMenuItem>
        </ContextMenu>
      )}

      {menu && menuQuery && (
        <ContextMenu x={menu.x} y={menu.y}>
          <ContextMenuHeader>{menuQuery.name}</ContextMenuHeader>
          <ContextMenuItem
            danger
            onClick={() => {
              onCloseQuery(menuQuery.id);
              close();
            }}
          >
            Close
          </ContextMenuItem>
        </ContextMenu>
      )}
    </aside>
  );
}
