import { useContextMenu } from '../hooks/useContextMenu';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { DEFAULT_ACCENT } from './ServerList';
import { IrcText } from './IrcText';

type Props = {
  channelName: string;
  topic: string | undefined;
  topicSetBy?: string;
  topicSetAt?: Date;
  isLog: boolean;
  isQuery?: boolean;
  isDCC?: boolean;
  // The current server's own color override (ServerList's per-server
  // colors), echoed here on the "#"/"@" prefix so a channel visibly
  // belongs to its server's color, not just the small rail icon - unset
  // falls back to the same default accent ServerList itself falls back to.
  serverColor?: string;
  // Only meaningful (and passed) for a DCC session - reuses the same
  // connecting/connected/disconnected status a server connection has, see
  // App.tsx's statusMap (DCC session ids share it, not just real serverIds).
  dccStatus?: 'connecting' | 'connected' | 'disconnected';
  // Omitted for a DCC session - its history isn't persisted at all (see
  // bouncer.DCCOffer's doc), so there's nothing here to export.
  onExport?: (format: 'text' | 'json') => void;
};

export function TopicBar({
  channelName, topic, topicSetBy, topicSetAt, isLog, isQuery, isDCC, dccStatus, onExport, serverColor,
}: Props) {
  const whoWhen = topicSetBy && `Set by ${topicSetBy}${topicSetAt ? ` at ${topicSetAt.toLocaleString()}` : ''}`;
  const { menu, open, close } = useContextMenu<null>();
  const prefixStyle = { color: serverColor ?? DEFAULT_ACCENT };
  return (
    <div className="h-12 flex items-center justify-between px-4 border-b border-[var(--dolq-border)] bg-[var(--dolq-bg)] shrink-0 shadow-[0_1px_0_rgba(0,0,0,0.2)]">
      <div className="flex items-center min-w-0">
        {isLog ? (
          <span className="font-semibold text-[var(--dolq-text)] text-[15px]">IRC Server Log</span>
        ) : isQuery ? (
          <>
            <span className="text-[16px] mr-1 font-bold" style={prefixStyle}>{isDCC ? '⚡' : '@'}</span>
            <span className="font-bold text-[var(--dolq-text)] text-[15px]">{channelName}</span>
            {isDCC && dccStatus && (
              <>
                <span className="text-[var(--dolq-border)] mx-3 text-lg">|</span>
                <span className="text-[var(--dolq-text-faint)] text-[13px] capitalize">{dccStatus}</span>
              </>
            )}
          </>
        ) : (
          <>
            <span className="text-[16px] mr-1 font-bold" style={prefixStyle}>#</span>
            <span className="font-bold text-[var(--dolq-text)] text-[15px]">{channelName}</span>
            {topic && (
              <>
                <span className="text-[var(--dolq-border)] mx-3 text-lg">|</span>
                <span className="text-[var(--dolq-text-muted)] text-[14px] truncate" title={whoWhen}>
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
            onClick={(e) => open(null, e)}
            title="Export"
            aria-label="Export"
            className="w-7 h-7 flex items-center justify-center rounded border-0 bg-transparent text-[var(--dolq-text-dim)] cursor-pointer hover:text-[var(--dolq-text)] hover:bg-[var(--dolq-bg-row-hover)]"
          >
            ⬇
          </button>
          {menu && (
            <ContextMenu x={menu.x} y={menu.y}>
              <ContextMenuItem onClick={() => { onExport('text'); close(); }}>
                Export as Text
              </ContextMenuItem>
              <ContextMenuItem onClick={() => { onExport('json'); close(); }}>
                Export as JSON
              </ContextMenuItem>
            </ContextMenu>
          )}
        </div>
      )}
    </div>
  );
}
