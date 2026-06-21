type Props = {
  x: number;
  y: number;
  children: React.ReactNode;
};

export function ContextMenu({ x, y, children }: Props) {
  return (
    <div
      className="fixed z-50 min-w-40 bg-[#18191c] rounded-md shadow-[0_4px_16px_rgba(0,0,0,0.4)] py-1.5"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

export function ContextMenuHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-1.5 text-[#96989d] text-[11px] font-bold uppercase tracking-[0.5px] truncate">
      {children}
    </div>
  );
}

export function ContextMenuItem(
  { danger, onClick, children }: { danger?: boolean; onClick: () => void; children: React.ReactNode },
) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-[13px] font-medium bg-transparent border-0 cursor-pointer ${
        danger
          ? 'text-[#ed4245] hover:bg-[#ed4245] hover:text-white'
          : 'text-[#dcddde] hover:bg-[#4a4f57]'
      }`}
    >
      {children}
    </button>
  );
}
