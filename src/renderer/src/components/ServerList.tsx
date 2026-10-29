import logo from '../../../../resources/icons/64x64.png';
import type { ConnectionStatus } from '../../../shared/ipc';
import { useContextMenu } from '../hooks/useContextMenu';
import type { Server } from '../types';
import { serverColor, serverIconText } from '../utils/server';
import { ContextMenu, ContextMenuHeader, ContextMenuItem } from './ContextMenu';

type Props = {
  servers: Server[];
  selectedId: string;
  onSelect: (id: string) => void;
  onAddServer: () => void;
  onRemove: (id: string) => void;
  onEditServer: (id: string) => void;
  statusMap: Record<string, ConnectionStatus>;
  onToggleConnection: (id: string) => void;
  dashboardActive: boolean;
  onOpenDashboard: () => void;
};

export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  disconnected: 'Disconnected',
};

const BADGE_COLOR: Record<ConnectionStatus, string> = {
  connected: 'bg-(--dolq-ok)',
  connecting: 'bg-(--dolq-warn)',
  disconnected: 'bg-(--dolq-text-faint)',
};

export function ServerList({
  servers,
  selectedId,
  onSelect,
  onAddServer,
  onRemove,
  onEditServer,
  statusMap,
  onToggleConnection,
  dashboardActive,
  onOpenDashboard,
}: Props) {
  const { menu, open, close, dismissIfUnhandled } = useContextMenu<string>();
  const menuServer = servers.find((s) => s.id === menu?.target);
  return (
    <aside
      className="relative flex flex-col w-17 bg-(--dolq-bg-panel-alt) border-r border-(--dolq-border) shrink-0"
      onContextMenu={dismissIfUnhandled}
    >
      <div className="flex-1 min-h-0 overflow-y-auto scroll-invisible flex flex-col items-center gap-2.5 px-3 py-3.5">
        <button
          type="button"
          aria-label="Dashboard"
          data-tip="Dashboard"
          aria-current={dashboardActive || undefined}
          onClick={onOpenDashboard}
          className={`has-tip tip-right w-10.5 h-10.5 shrink-0 cursor-pointer select-none overflow-hidden rounded-[13px] border-0 bg-transparent p-0 transition-[border-radius] duration-150 hover:rounded-2xl ${
            dashboardActive ? 'ring-2 ring-offset-2 ring-(--dolq-text) ring-offset-(--dolq-bg-panel-alt)' : ''
          }`}
        >
          <img src={logo} alt="" className="size-full" />
        </button>
        <div className="my-1 h-px w-6 bg-(--dolq-border)" />
        {servers.map((s) => {
          const status = statusMap[s.id] ?? 'disconnected';
          return (
            <button
              type="button"
              key={s.id}
              aria-label={s.name}
              data-tip={s.name}
              onClick={() => onSelect(s.id)}
              onContextMenu={(e) => open(s.id, e)}
              style={{ background: serverColor(s) }}
              className={`has-tip tip-right relative w-10.5 h-10.5 shrink-0 text-[15px] font-semibold text-white cursor-pointer select-none border-0 rounded-[13px] transition-[border-radius] duration-150 hover:rounded-2xl ${
                s.id === selectedId ? 'ring-2 ring-offset-2 ring-(--dolq-text) ring-offset-(--dolq-bg-panel-alt)' : ''
              }`}
            >
              {serverIconText(s)}
              <span
                role="img"
                aria-label={STATUS_LABEL[status]}
                data-tip={STATUS_LABEL[status]}
                className={`has-tip tip-right absolute -right-1 -bottom-1 w-3.75 h-3.75 rounded-full border-[3px] border-(--dolq-bg-panel-alt) ${BADGE_COLOR[status]}`}
              />
            </button>
          );
        })}
        {servers.length !== 0 && <div className="w-6 h-px bg-(--dolq-border) my-1" />}
        <button
          type="button"
          aria-label="Add server"
          data-tip="Add server"
          onClick={onAddServer}
          className="has-tip tip-right w-10.5 h-10.5 shrink-0 rounded-[13px] border-[1.5px] border-dashed border-(--dolq-border-strong) bg-transparent text-(--dolq-text-dim) flex items-center justify-center cursor-pointer hover:text-(--dolq-text) hover:border-(--dolq-text) transition-colors select-none"
        >
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {menu && menuServer && (
        <ContextMenu x={menu.x} y={menu.y}>
          <ContextMenuHeader>{menuServer.name}</ContextMenuHeader>
          <ContextMenuItem
            onClick={() => {
              onToggleConnection(menuServer.id);
              close();
            }}
          >
            {(statusMap[menuServer.id] ?? 'disconnected') === 'disconnected' ? 'Connect' : 'Disconnect'}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              onEditServer(menuServer.id);
              close();
            }}
          >
            Edit Server…
          </ContextMenuItem>
          <ContextMenuItem
            danger
            onClick={() => {
              onRemove(menuServer.id);
              close();
            }}
          >
            Remove Server
          </ContextMenuItem>
        </ContextMenu>
      )}
    </aside>
  );
}
