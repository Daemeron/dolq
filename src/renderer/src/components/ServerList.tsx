import { Server } from '../types';
import { useContextMenu } from '../hooks/useContextMenu';
import { ContextMenu, ContextMenuHeader, ContextMenuItem } from './ContextMenu';

type Props = {
  servers: Server[];
  selectedId: string;
  onSelect: (id: string) => void;
  onAddServer: () => void;
  onRemove: (id: string) => void;
};

export function ServerList({ servers, selectedId, onSelect, onAddServer, onRemove }: Props) {
  const { menu, open, close, dismissIfUnhandled } = useContextMenu<string>();
  const menuServer = servers.find((s) => s.id === menu?.target);

  return (
    <aside
      className="relative flex flex-col w-18 bg-[#18191a] shrink-0 overflow-hidden"
      onContextMenu={dismissIfUnhandled}
    >
      <div className="flex-1 min-h-0 overflow-y-auto scroll-invisible flex flex-col items-center gap-2 px-3 pt-3 pb-3 mb-30">
        {servers.map((s) => (
          <button
            key={s.id}
            title={s.name}
            onClick={() => onSelect(s.id)}
            onContextMenu={(e) => open(s.id, e)}
            className={`w-12 h-12 text-[18px] font-bold cursor-pointer select-none border-0 rounded-[30%] transition-[background] duration-150 ${
              s.id === selectedId
                ? 'bg-[#c792ea] text-white text-shadow-sm'
                : 'bg-[#212121] text-[#e6e6e6] hover:bg-[#c792ea] hover:text-white hover:text-shadow-sm'
            }`}
          >
            {s.initial}
          </button>
        ))}
        {servers.length !== 0 && (
          <div className="w-8 h-px bg-[#212121] my-1" />
        )}
        <button
          title="Add server"
          onClick={onAddServer}
          className="w-12 h-12 rounded-full bg-[#212121] text-[#50fa7b] flex items-center justify-center cursor-pointer border-0 hover:bg-[#50fa7b] hover:text-white hover:text-shadow-sm transition-[border-radius,background] duration-150 select-none"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="10" y1="3" x2="10" y2="17" />
            <line x1="3" y1="10" x2="17" y2="10" />
          </svg>
        </button>
      </div>

      {menu && menuServer && (
        <ContextMenu x={menu.x} y={menu.y}>
          <ContextMenuHeader>{menuServer.name}</ContextMenuHeader>
          <ContextMenuItem danger onClick={() => { onRemove(menuServer.id); close(); }}>
            Remove Server
          </ContextMenuItem>
        </ContextMenu>
      )}
    </aside>
  );
}
