import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode, useId } from 'react';

// The design system's building blocks (docs/design-system/README.md). Panels compose these instead of styling their own.

export const inputClass =
  'h-9.5 w-full rounded-lg border border-(--dolq-border-strong) bg-(--dolq-bg-input) px-3 text-[14px] text-(--dolq-text) outline-none placeholder:text-(--dolq-text-faint) focus:border-(--dolq-accent) focus:shadow-[0_0_0_3px_var(--dolq-accent-soft)] disabled:opacity-50';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANT: Record<Variant, string> = {
  primary:
    'border-(--dolq-accent) bg-(--dolq-accent) text-(--dolq-on-accent) hover:border-(--dolq-accent-hover) hover:bg-(--dolq-accent-hover)',
  secondary: 'border-(--dolq-border-strong) bg-transparent text-(--dolq-text) hover:bg-(--dolq-bg-row-hover)',
  ghost: 'border-transparent bg-transparent text-(--dolq-text) hover:bg-(--dolq-bg-row-hover)',
  danger: 'border-transparent bg-transparent text-(--dolq-danger) hover:bg-(--dolq-bg-row-hover)',
};

export function Button({
  variant = 'secondary',
  small,
  className = '',
  type = 'button',
  ...rest
}: { variant?: Variant; small?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border font-medium transition-colors disabled:cursor-default disabled:opacity-50 ${
        small ? 'h-7.5 px-2.5 text-[13px]' : 'h-9 px-3.5 text-[14px]'
      } ${VARIANT[variant]} ${className}`}
      {...rest}
    />
  );
}

/** A labelled control. The label wraps the control, so clicking it focuses the control. */
export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the label wraps whatever control is passed as children
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-[13px] font-medium text-(--dolq-text-muted)">{label}</span>
      {children}
    </label>
  );
}

/** A checkbox drawn as the design's switch. Still a checkbox to assistive tech. */
export function Switch(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <input
      type="checkbox"
      {...props}
      className="relative h-5 w-8.5 shrink-0 cursor-pointer appearance-none rounded-full bg-(--dolq-border-strong) transition-colors before:absolute before:top-0.5 before:left-0.5 before:size-4 before:rounded-full before:bg-white before:transition-[left] before:content-[''] checked:bg-(--dolq-accent) checked:before:left-4"
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`divide-y divide-(--dolq-border) rounded-xl border border-(--dolq-border) bg-(--dolq-bg-input) ${className}`}
    >
      {children}
    </div>
  );
}

const CONTROLS = new Set(['input', 'select', 'textarea']);

/** One row of a Card: a title and optional description on the left, the control on the right. */
export function Setting({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  const id = useId();
  // The control is named by the title alone, so the description is not part of its accessible name.
  const control = Children.map(children, (child) =>
    (isValidElement(child) && typeof child.type === 'string') || (isValidElement(child) && child.type === Switch)
      ? cloneElement(child as ReactElement<{ 'aria-labelledby'?: string }>, { 'aria-labelledby': id })
      : child,
  );
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3.5">
      <div className="min-w-0">
        <div id={id} className="text-[14px] font-medium text-(--dolq-text)">
          {title}
        </div>
        {description && <div className="text-[13px] text-(--dolq-text-dim)">{description}</div>}
      </div>
      {control && <div className="flex shrink-0 items-center gap-2">{control}</div>}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex shrink-0 gap-1 border-b border-(--dolq-border) px-5">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          className={`-mb-px h-10 cursor-pointer border-0 border-b-2 bg-transparent px-2.5 font-medium transition-colors ${
            t.id === value
              ? 'border-(--dolq-accent) text-(--dolq-text)'
              : 'border-transparent text-(--dolq-text-dim) hover:text-(--dolq-text)'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** A few mutually exclusive choices as small buttons. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {options.map((o) => (
        <Button
          key={o.id}
          small
          variant={o.id === value ? 'secondary' : 'ghost'}
          // biome-ignore lint/a11y/useSemanticElements: a toggle button standing in for a radio, per the design
          role="radio"
          aria-checked={o.id === value}
          className={o.id === value ? 'bg-(--dolq-bg-row-selected)' : ''}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}
