import { useModalA11y } from '../hooks/useModalA11y';

type Props = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
};

/** A floating dialog over the chat; callers handle Escape themselves. */
export function ViewPanel({ title, onClose, children }: Props) {
  const dialogRef = useModalA11y<HTMLDivElement>();

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-dismiss, Escape is handled by the caller
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="flex flex-col w-full max-w-170 max-h-full rounded-2xl bg-(--dolq-bg) shadow-(--dolq-shadow) overflow-hidden outline-none"
      >
        <div className="h-14 flex items-center justify-between pl-6 pr-3 shrink-0">
          <h1 className="m-0 font-(family-name:--dolq-font-serif) font-medium text-(--dolq-text) text-[22px]">
            {title}
          </h1>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-tip="Close"
            className="has-tip w-8.5 h-8.5 flex items-center justify-center rounded-lg border-0 bg-transparent text-(--dolq-text-dim) cursor-pointer hover:text-(--dolq-text) hover:bg-(--dolq-bg-row-hover)"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 pt-2">{children}</div>
      </div>
    </div>
  );
}
