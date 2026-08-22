type Props = {
  currentNick: string;
  away: boolean;
  onOpenPreferences: () => void;
};

// The connection status button used to live glued to the top of this same
// card - split into its own ConnectionStatus component, which now sits at
// the top of the right-hand column instead (above UserList), while this
// stays a floating card at the bottom of the server rail.
export function UserPanel({ currentNick, away, onOpenPreferences }: Props) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 bg-[var(--dolq-bg-raised)] rounded-lg shrink-0">
      <div className={`w-9 h-9 rounded-full text-white text-shadow-sm flex items-center justify-center font-bold text-sm shrink-0 ${away ? 'bg-[var(--dolq-text-faint)]' : 'bg-[#c792ea]'}`}>
        {currentNick[0]?.toUpperCase() ?? '?'}
      </div>
      <span className="text-[14px] font-semibold text-[var(--dolq-text)] truncate flex-1">
        {currentNick}
        {away && <span className="text-[var(--dolq-text-dim)] font-normal"> (away)</span>}
      </span>
      <button
        onClick={onOpenPreferences}
        title="Preferences"
        aria-label="Preferences"
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded border-0 bg-transparent text-[var(--dolq-text-dim)] cursor-pointer hover:text-[var(--dolq-text)] hover:bg-[var(--dolq-bg-row-hover)]"
      >
        ⚙
      </button>
    </div>
  );
}
