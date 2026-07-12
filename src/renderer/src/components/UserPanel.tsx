type Props = {
  currentNick: string;
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  onConnect: () => void;
  onDisconnect: () => void;
};

export function UserPanel({ currentNick, connectionStatus, onConnect, onDisconnect }: Props) {
  const btnColor = connectionStatus === 'connected'
    ? 'bg-[#50fa7b] hover:bg-[#ff5555]'
    : connectionStatus === 'connecting'
    ? 'bg-[#6b6b6b] cursor-not-allowed'
    : 'bg-[#6b6b6b] hover:bg-[#50fa7b]';

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
      <div className="flex items-center gap-3 px-4 py-3.5 bg-[#262626] rounded-b-lg">
        <div className="w-9 h-9 rounded-full bg-[#c792ea] text-white text-shadow-sm flex items-center justify-center font-bold text-sm shrink-0">
          {currentNick[0]?.toUpperCase() ?? '?'}
        </div>
        <span className="text-[14px] font-semibold text-white truncate">{currentNick}</span>
      </div>
    </div>
  );
}
