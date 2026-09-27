type Props = {
  currentNick: string;
  away: boolean;
  onOpenPreferences: () => void;
};

export function UserPanel({ currentNick, away, onOpenPreferences }: Props) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 bg-(--dolq-bg-raised) rounded-lg shrink-0">
      <div
        className={`w-9 h-9 rounded-full text-white text-shadow-sm flex items-center justify-center font-bold text-sm shrink-0 ${away ? 'bg-(--dolq-text-faint)' : 'bg-[#c792ea]'}`}
      >
        {currentNick[0]?.toUpperCase() ?? '?'}
      </div>
      <span className="text-[14px] font-semibold text-(--dolq-text) truncate flex-1">
        {currentNick}
        {away && <span className="text-(--dolq-text-dim) font-normal"> (away)</span>}
      </span>
      <button
        type="button"
        onClick={onOpenPreferences}
        title="Preferences"
        aria-label="Preferences"
        className="shrink-0 w-9 h-9 flex items-center justify-center rounded border-0 bg-transparent text-[28px] text-(--dolq-text-dim) cursor-pointer hover:text-(--dolq-text) hover:bg-(--dolq-bg-row-hover)"
      >
        ⚙
      </button>
    </div>
  );
}
