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
      <div className="h-14 flex items-center justify-between pl-5 pr-3 border-b border-(--dolq-border) bg-(--dolq-bg) shrink-0">
        <h1 className="m-0 font-(family-name:--dolq-font-serif) font-medium text-(--dolq-text) text-[20px]">{title}</h1>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close"
          className="w-8.5 h-8.5 flex items-center justify-center rounded-lg border-0 bg-transparent text-(--dolq-text-dim) cursor-pointer hover:text-(--dolq-text) hover:bg-(--dolq-bg-row-hover)"
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
