type Props = {
  currentNick: string;
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  away: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onOpenPreferences: () => void;
};

export function UserPanel({ currentNick, connectionStatus, away, onConnect, onDisconnect, onOpenPreferences }: Props) {
  const btnColor = connectionStatus === 'connected'
    ? 'bg-[#50fa7b] hover:bg-[#ff5555]'
    : connectionStatus === 'connecting'
    ? 'bg-[var(--dolq-text-faint)] cursor-not-allowed'
    : 'bg-[var(--dolq-text-faint)] hover:bg-[#50fa7b]';

  return (
    <div className="shrink-0">
      <button
        onClick={connectionStatus === 'connecting' ? undefined : connectionStatus === 'connected' ? onDisconnect : onConnect}
        disabled={connectionStatus === 'connecting'}
        className={`group w-full py-2.5 rounded-t-lg text-sm font-medium text-white text-shadow-sm transition-colors ${btnColor}`}
      >
        {connectionStatus === 'connecting' ? 'Connecting…' : connectionStatus === 'connected' ? (
          <>
            <span className="group-hover:hidden">Connected</span>
            <span className="hidden group-hover:inline">Disconnect</span>
          </>
        ) : (
          <>
            <span className="group-hover:hidden">Disconnected</span>
            <span className="hidden group-hover:inline">Connect</span>
          </>
        )}
      </button>
      <div className="flex items-center gap-3 px-4 py-3.5 bg-[var(--dolq-bg-raised)] rounded-b-lg">
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
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded border-0 bg-transparent text-[var(--dolq-text-dim)] cursor-pointer hover:text-[var(--dolq-text)] hover:bg-[var(--dolq-bg-row-hover)]"
        >
          ⚙
        </button>
      </div>
    </div>
  );
}
