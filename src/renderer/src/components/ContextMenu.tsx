import { useLayoutEffect, useRef, useState } from 'react';
import { placeMenu } from '../utils/placeMenu';
import { Icon } from './Icon';

type Props = {
  x: number;
  y: number;
  children: React.ReactNode;
};

export function ContextMenu({ x, y, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Opened at the pointer, then moved back inside the window once its size is known.
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (box) {
      setAt(
        placeMenu(
          { x, y },
          { width: box.width, height: box.height },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    }
  }, [x, y]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-dismiss, Escape is handled separately
    <div
      ref={ref}
      role="presentation"
      className="fixed z-50 min-w-40 bg-(--dolq-bg-input) rounded-lg shadow-(--dolq-shadow) py-1.5"
      style={{ left: at?.left ?? x, top: at?.top ?? y, visibility: at ? 'visible' : 'hidden' }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

export function ContextMenuHeader({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-1.5 text-(--dolq-text-dim) text-[12px] font-medium truncate">{children}</div>;
}

export function ContextMenuItem({
  danger,
  checked,
  onClick,
  children,
}: {
  danger?: boolean;
  /** Set for one of several exclusive choices: true marks the current one. */
  checked?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      {...(checked === undefined ? {} : { role: 'menuitemradio', 'aria-checked': checked })}
      onClick={onClick}
      className={`flex items-center w-[calc(100%-8px)] mx-1 text-left px-2.5 py-1.5 text-[13px] rounded-md bg-transparent border-0 cursor-pointer hover:bg-(--dolq-bg-row-hover) ${
        danger ? 'text-(--dolq-danger)' : 'text-(--dolq-text)'
      }`}
    >
      {checked !== undefined && (
        <span className="inline-flex w-5 shrink-0">{checked && <Icon name="check" size={14} />}</span>
      )}
      {children}
    </button>
  );
}
