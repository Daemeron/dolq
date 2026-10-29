const PATHS = {
  at: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
  bellOff: 'M6 8a6 6 0 0 1 9.3-5M18 8c0 3 .6 5 1.4 6.5M3 17s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0M3 3l18 18',
  download: 'M12 3v12m0 0-4-4m4 4 4-4M4 21h16',
  export: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 11v6m0 0-2.5-2.5M12 17l2.5-2.5',
  users:
    'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  power: 'M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0',
  terminal: 'm4 17 6-6-6-6M12 19h8',
  plus: 'M12 5v14M5 12h14',
  arrowLeft: 'M19 12H5m0 0 6-6m-6 6 6 6',
  arrowRight: 'M5 12h14m0 0-6-6m6 6-6 6',
  send: 'M12 19V5m0 0-6 6m6-6 6 6',
  smile: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  zap: 'M13 2 4 14h7l-1 8 9-12h-7z',
  close: 'M6 6l12 12M18 6 6 18',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4v16l13-8z',
  paperclip: 'm21 12-8.5 8.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 8',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM9 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Square icon button used for toolbars. `on` marks a toggled-on state. */
export function IconButton({
  icon,
  label,
  onClick,
  on,
  badge,
  compact,
}: {
  icon: IconName;
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  on?: boolean;
  /** A small accent dot for something unseen. */
  badge?: boolean;
  /** A slimmer button, for the title strip. */
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      data-tip={label}
      className={`has-tip relative ${compact ? 'size-7' : 'size-8.5'} flex items-center justify-center rounded-lg border-0 cursor-pointer hover:text-(--dolq-text) hover:bg-(--dolq-bg-row-hover) ${
        on ? 'bg-(--dolq-bg-row-selected) text-(--dolq-text)' : 'bg-transparent text-(--dolq-text-dim)'
      }`}
    >
      <Icon name={icon} size={compact ? 16 : 18} />
      {badge && (
        <span
          data-testid="icon-badge"
          className="absolute top-1.5 right-1.5 w-1.75 h-1.75 rounded-full bg-(--dolq-accent) border-2 border-(--dolq-bg)"
        />
      )}
    </button>
  );
}
