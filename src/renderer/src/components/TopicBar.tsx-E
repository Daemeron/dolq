import type { ConnectionStatus } from '../../../shared/ipc';
import { useContextMenu } from '../hooks/useContextMenu';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { IconButton } from './Icon';
import { IrcText } from './IrcText';

type Props = {
  channelName: string;
  topic: string | undefined;
  topicSetBy?: string;
  topicSetAt?: Date;
  isLog: boolean;
  isQuery?: boolean;
  isDCC?: boolean;
  dccStatus?: 'connecting' | 'connected' | 'disconnected';
  onExport?: (format: 'text' | 'json') => void;
  onOpenSearch: () => void;
  connectionStatus: ConnectionStatus;
  onToggleConnection: () => void;
  muted?: boolean;
  onToggleMute?: () => void;
  showMembers?: boolean;
  onToggleMembers?: () => void;
};

export function TopicBar({
  channelName,
  topic,
  topicSetBy,
  topicSetAt,
  isLog,
  isQuery,
  isDCC,
  dccStatus,
  onExport,
  onOpenSearch,
  connectionStatus,
  onToggleConnection,
  muted,
  onToggleMute,
  showMembers,
  onToggleMembers,
}: Props) {
  const whoWhen = topicSetBy && `Set by ${topicSetBy}${topicSetAt ? ` at ${topicSetAt.toLocaleString()}` : ''}`;
  const { menu, open, close } = useContextMenu<null>();
  const title = isLog ? 'Server log' : isQuery ? channelName : `#${channelName}`;
  const connected = connectionStatus === 'connected';
  return (
    <div className="h-14 flex items-center gap-3 pl-5 pr-3 border-b border-(--dolq-border) bg-(--dolq-bg) shrink-0">
      <h1 className="m-0 font-(family-name:--dolq-font-serif) font-medium text-[20px] text-(--dolq-text) whitespace-nowrap">
        {title}
      </h1>
      {isDCC && dccStatus && <span className="text-(--dolq-text-dim) text-[13px] capitalize">{dccStatus}</span>}
      <span className="flex-1 min-w-0 text-(--dolq-text-dim) text-[13px] truncate" title={whoWhen}>
        {!isLog && !isQuery && topic && <IrcText text={topic} />}
      </span>

      <div role="toolbar" aria-label="Conversation actions" className="flex items-center gap-0.5 shrink-0">
        <IconButton icon="search" label="Search history" onClick={onOpenSearch} />
        {onToggleMute && (
          <IconButton
            icon={muted ? 'bellOff' : 'bell'}
            label={muted ? 'Unmute channel' : 'Mute channel'}
            onClick={onToggleMute}
            on={muted}
          />
        )}
        {onExport && (
          <>
            <IconButton icon="export" label="Export log" onClick={(e) => open(null, e)} />
            {menu && (
              <ContextMenu x={menu.x} y={menu.y}>
                <ContextMenuItem
                  onClick={() => {
                    onExport('text');
                    close();
                  }}
                >
                  Export as Text
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => {
                    onExport('json');
                    close();
                  }}
                >
                  Export as JSON
                </ContextMenuItem>
              </ContextMenu>
            )}
          </>
        )}
        <IconButton
          icon="power"
          label={connected ? 'Disconnect' : connectionStatus === 'connecting' ? 'Connecting…' : 'Connect'}
          onClick={onToggleConnection}
          on={connected}
        />
        {onToggleMembers && (
          <>
            <span className="w-px h-4.5 bg-(--dolq-border) mx-1.5" />
            <IconButton icon="users" label="Members" onClick={onToggleMembers} on={showMembers} />
          </>
        )}
      </div>
    </div>
  );
}
