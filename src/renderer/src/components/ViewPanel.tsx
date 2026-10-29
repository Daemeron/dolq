import { useModalA11y } from '../hooks/useModalA11y';
import { IconButton } from './Icon';

type Props = {
  title: string;
  description?: React.ReactNode;
  onClose: () => void;
  /** Shown before the title, such as an avatar. */
  leading?: React.ReactNode;
  /** Buttons along the bottom edge. */
  footer?: React.ReactNode;
  /** When set, the body and footer are one form submitted with this handler. */
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  /** Content between the header and the body that does not scroll, such as tabs. */
  toolbar?: React.ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
  /** Opens from the top, like a command palette, instead of the middle. */
  top?: boolean;
  /** Keeps the title for screen readers only; the toolbar carries the header. */
  hideTitle?: boolean;
  children: React.ReactNode;
};

const WIDTH = { sm: 'max-w-120', md: 'max-w-140', lg: 'max-w-170', xl: 'max-w-190' };

/** A floating dialog over the chat; callers handle Escape themselves. */
export function ViewPanel({
  title,
  description,
  onClose,
  leading,
  footer,
  onSubmit,
  toolbar,
  width = 'lg',
  top,
  hideTitle,
  children,
}: Props) {
  const dialogRef = useModalA11y<HTMLDivElement>();
  const content = (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pt-2 pb-5">{children}</div>
      {footer && (
        <div className="flex shrink-0 justify-end gap-2 border-t border-(--dolq-border) bg-(--dolq-bg-panel) px-6 py-3.5">
          {footer}
        </div>
      )}
    </>
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-dismiss, Escape is handled by the caller
    <div
      role="presentation"
      className={`titlebar-nodrag fixed inset-0 z-50 flex justify-center bg-black/60 p-6 ${top ? 'items-start pt-[10vh]' : 'items-center'}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`flex max-h-full w-full flex-col overflow-hidden rounded-2xl bg-(--dolq-bg) shadow-(--dolq-shadow) outline-none ${WIDTH[width]}`}
      >
        {hideTitle ? (
          <h1 className="sr-only">{title}</h1>
        ) : (
          <div className="flex shrink-0 items-start gap-3.5 px-6 pt-5 pb-3">
            {leading}
            <div className="min-w-0 flex-1">
              <h1 className="m-0 font-(family-name:--dolq-font-serif) text-[22px] leading-tight font-medium text-(--dolq-text)">
                {title}
              </h1>
              {description && <p className="m-0 mt-1 text-[13px] text-(--dolq-text-dim)">{description}</p>}
            </div>
            <IconButton icon="close" label="Close" onClick={onClose} />
          </div>
        )}
        {toolbar}
        {onSubmit ? (
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            {content}
          </form>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">{content}</div>
        )}
      </div>
    </div>
  );
}
