import type { ReactNode } from 'react';
import type { ConnectionStatus } from '../../../shared/ipc';
import { useContextMenu } from '../hooks/useContextMenu';
import type { Server } from '../types';
import { serverColor, serverIconText } from '../utils/server';
import { ContextMenu, ContextMenuHeader, ContextMenuItem } from './ContextMenu';
import { DolqMark } from './DolqMark';

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
  /** Pinned under the servers, such as the state of the backend link. */
  footer?: ReactNode;
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

// The hover effect of every button in the rail: it lifts and brightens a little, and presses back in when clicked.
// Tailwind sets translate and scale as properties of their own, so they are what is transitioned, not transform.
const LIFT =
  'transition-[translate,scale,filter,box-shadow,background-color,color,border-color] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:scale-105 hover:brightness-110 hover:shadow-md active:translate-y-0 active:scale-95';

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
  footer,
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
          className={`has-tip tip-right flex w-10.5 h-10.5 shrink-0 cursor-pointer select-none items-center justify-center rounded-[13px] border-0 bg-(--dolq-accent) p-0 text-(--dolq-on-accent) ${LIFT} hover:bg-(--dolq-accent-hover) ${
            dashboardActive ? 'ring-2 ring-offset-2 ring-(--dolq-text) ring-offset-(--dolq-bg-panel-alt)' : ''
          }`}
        >
          <DolqMark className="h-8 w-auto" />
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
              className={`has-tip tip-right relative w-10.5 h-10.5 shrink-0 text-[15px] font-semibold text-white cursor-pointer select-none border-0 rounded-[13px] ${LIFT} ${
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
          className={`has-tip tip-right w-10.5 h-10.5 shrink-0 rounded-[13px] border-[1.5px] border-dashed border-(--dolq-border-strong) bg-transparent text-(--dolq-text-dim) flex items-center justify-center cursor-pointer hover:text-(--dolq-text) hover:border-(--dolq-text) ${LIFT} select-none`}
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
      {footer && <div className="flex shrink-0 flex-col items-center gap-2 px-3 pb-3">{footer}</div>}

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
