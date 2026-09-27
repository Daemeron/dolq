import { useEffect, useRef } from 'react';
import { FOCUSABLE } from '../hooks/useModalA11y';

type Props = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
};

export function ViewPanel({ title, onClose, children }: Props) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const content = contentRef.current;
    const focusable = content?.querySelector<HTMLElement>(FOCUSABLE);
    (focusable ?? content)?.focus();
  }, []);

  return (
    <>
      <div className="h-12 flex items-center justify-between px-4 border-b border-(--dolq-border) bg-(--dolq-bg) shrink-0 shadow-[0_1px_0_rgba(0,0,0,0.2)]">
        <span className="font-semibold text-(--dolq-text) text-[15px]">{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close"
          className="w-7 h-7 flex items-center justify-center rounded border-0 bg-transparent text-(--dolq-text-dim) cursor-pointer hover:text-(--dolq-text) hover:bg-(--dolq-bg-row-hover)"
        >
          ✕
        </button>
      </div>
      <div ref={contentRef} tabIndex={-1} className="flex-1 overflow-y-auto scroll-thin p-8 outline-none">
        {children}
      </div>
    </>
  );
}
