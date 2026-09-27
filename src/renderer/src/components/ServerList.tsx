import { useRef } from 'react';
import { useContextMenu } from '../hooks/useContextMenu';
import type { Server } from '../types';
import { ContextMenu, ContextMenuHeader, ContextMenuItem } from './ContextMenu';

type Props = {
  servers: Server[];
  selectedId: string;
  onSelect: (id: string) => void;
  onAddServer: () => void;
  onRemove: (id: string) => void;
  onChangeColor: (id: string, color: string) => void;
  onEditServer: (id: string) => void;
};

export const DEFAULT_ACCENT = '#c792ea';

export function ServerList({
  servers,
  selectedId,
  onSelect,
  onAddServer,
  onRemove,
  onChangeColor,
  onEditServer,
}: Props) {
  const { menu, open, close, dismissIfUnhandled } = useContextMenu<string>();
  const menuServer = servers.find((s) => s.id === menu?.target);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const colorTargetRef = useRef<string | null>(null);

  function handleChangeColorClick(id: string, current?: string) {
    colorTargetRef.current = id;
    const input = colorInputRef.current;
    if (!input) return;
    input.value = current ?? DEFAULT_ACCENT;
    input.click();
  }

  return (
    <aside
      className="relative flex flex-col w-18 bg-(--dolq-bg-panel-alt) shrink-0 overflow-hidden"
      onContextMenu={dismissIfUnhandled}
    >
      <div className="flex-1 min-h-0 overflow-y-auto scroll-invisible flex flex-col items-center gap-2 px-3 pt-3 pb-3 mb-30">
        {servers.map((s) => (
          <button
            type="button"
            key={s.id}
            title={s.name}
            aria-label={s.name}
            onClick={() => onSelect(s.id)}
            onContextMenu={(e) => open(s.id, e)}
            style={{ '--server-accent': s.color ?? DEFAULT_ACCENT } as React.CSSProperties}
            className={`w-12 h-12 text-[18px] font-bold cursor-pointer select-none border-0 rounded-[30%] transition-[background] duration-150 ${
              s.id === selectedId
                ? 'bg-(--server-accent) text-white text-shadow-sm'
                : 'bg-(--dolq-bg) text-(--dolq-text) hover:bg-(--server-accent) hover:text-white hover:text-shadow-sm'
            }`}
          >
            {s.initial}
          </button>
        ))}
        {servers.length !== 0 && <div className="w-8 h-px bg-(--dolq-bg) my-1" />}
        <button
          type="button"
          title="Add server"
          aria-label="Add server"
          onClick={onAddServer}
          className="w-12 h-12 rounded-full bg-(--dolq-bg) text-[#50fa7b] flex items-center justify-center cursor-pointer border-0 hover:bg-[#50fa7b] hover:text-white hover:text-shadow-sm transition-[border-radius,background] duration-150 select-none"
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <line x1="10" y1="3" x2="10" y2="17" />
            <line x1="3" y1="10" x2="17" y2="10" />
          </svg>
        </button>
      </div>

      <input
        ref={colorInputRef}
        type="color"
        className="hidden"
        onChange={(e) => {
          if (colorTargetRef.current) onChangeColor(colorTargetRef.current, e.target.value);
        }}
      />

      {menu && menuServer && (
        <ContextMenu x={menu.x} y={menu.y}>
          <ContextMenuHeader>{menuServer.name}</ContextMenuHeader>
          <ContextMenuItem
            onClick={() => {
              onEditServer(menuServer.id);
              close();
            }}
          >
            Edit Server…
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              handleChangeColorClick(menuServer.id, menuServer.color);
              close();
            }}
          >
            Change Color…
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
