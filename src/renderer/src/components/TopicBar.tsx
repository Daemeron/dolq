import { useContextMenu } from '../hooks/useContextMenu';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { IrcText } from './IrcText';
import { DEFAULT_ACCENT } from './ServerList';

type Props = {
  channelName: string;
  topic: string | undefined;
  topicSetBy?: string;
  topicSetAt?: Date;
  isLog: boolean;
  isQuery?: boolean;
  isDCC?: boolean;
  serverColor?: string;
  dccStatus?: 'connecting' | 'connected' | 'disconnected';
  onExport?: (format: 'text' | 'json') => void;
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
  serverColor,
}: Props) {
  const whoWhen = topicSetBy && `Set by ${topicSetBy}${topicSetAt ? ` at ${topicSetAt.toLocaleString()}` : ''}`;
  const { menu, open, close } = useContextMenu<null>();
  const prefixStyle = { color: serverColor ?? DEFAULT_ACCENT };
  return (
    <div className="h-12 flex items-center justify-between px-4 border-b border-(--dolq-border) bg-(--dolq-bg) shrink-0 shadow-[0_1px_0_rgba(0,0,0,0.2)]">
      <div className="flex items-center min-w-0">
        {isLog ? (
          <span className="font-semibold text-(--dolq-text) text-[15px]">IRC Server Log</span>
        ) : isQuery ? (
          <>
            <span className="text-[16px] mr-1 font-bold" style={prefixStyle}>
              {isDCC ? '⚡' : '@'}
            </span>
            <span className="font-bold text-(--dolq-text) text-[15px]">{channelName}</span>
            {isDCC && dccStatus && (
              <>
                <span className="text-(--dolq-border) mx-3 text-lg">|</span>
                <span className="text-(--dolq-text-faint) text-[13px] capitalize">{dccStatus}</span>
              </>
            )}
          </>
        ) : (
          <>
            <span className="text-[16px] mr-1 font-bold" style={prefixStyle}>
              #
            </span>
            <span className="font-bold text-(--dolq-text) text-[15px]">{channelName}</span>
            {topic && (
              <>
                <span className="text-(--dolq-border) mx-3 text-lg">|</span>
                <span className="text-(--dolq-text-muted) text-[14px] truncate" title={whoWhen}>
                  <IrcText text={topic} />
                </span>
              </>
            )}
          </>
        )}
      </div>

      {onExport && (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={(e) => open(null, e)}
            title="Export"
            aria-label="Export"
            className="w-7 h-7 flex items-center justify-center rounded border-0 bg-transparent text-(--dolq-text-dim) cursor-pointer hover:text-(--dolq-text) hover:bg-(--dolq-bg-row-hover)"
          >
            ⬇
          </button>
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
        </div>
      )}
    </div>
  );
}
