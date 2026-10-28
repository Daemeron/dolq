import { nickColor, nickInitial } from '../utils/nickColor';

type Props = {
  currentNick: string;
  away: boolean;
  onOpenPreferences: () => void;
};

export function UserPanel({ currentNick, away, onOpenPreferences }: Props) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 border-t border-(--dolq-border) shrink-0">
      <div
        className="w-7 h-7 rounded-full text-white flex items-center justify-center font-semibold text-xs shrink-0"
        style={{ background: away ? 'var(--dolq-text-faint)' : nickColor(currentNick) }}
      >
        {nickInitial(currentNick)}
      </div>
      <div className="flex-1 min-w-0 leading-tight">
        <div className="text-[13px] font-medium text-(--dolq-text) truncate">{currentNick}</div>
        <div className="text-[12px] text-(--dolq-text-dim)">{away ? 'Away' : 'Online'}</div>
      </div>
      <button
        type="button"
        onClick={onOpenPreferences}
        data-tip="Preferences"
        aria-label="Preferences"
        className="has-tip shrink-0 w-8.5 h-8.5 flex items-center justify-center rounded-lg border-0 bg-transparent text-(--dolq-text-dim) cursor-pointer hover:text-(--dolq-text) hover:bg-(--dolq-bg-row-hover)"
      >
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
          <circle cx="15" cy="7" r="2" />
          <circle cx="9" cy="17" r="2" />
        </svg>
      </button>
    </div>
  );
}
