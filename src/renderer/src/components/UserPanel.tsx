type Props = {
  currentNick: string;
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  onConnect: () => void;
  onDisconnect: () => void;
};

export function UserPanel({ currentNick, connectionStatus, onConnect, onDisconnect }: Props) {
  const btnColor = connectionStatus === 'connected'
    ? 'bg-[#3ba55d] hover:bg-[#ed4245]'
    : connectionStatus === 'connecting'
    ? 'bg-[#72767d] cursor-not-allowed'
    : 'bg-[#72767d] hover:bg-[#3ba55d]';

  return (
    <div className="shrink-0">
      <button
        onClick={connectionStatus === 'connecting' ? undefined : connectionStatus === 'connected' ? onDisconnect : onConnect}
        disabled={connectionStatus === 'connecting'}
        className={`group w-full py-2.5 rounded-t-lg text-sm font-medium text-white transition-colors ${btnColor}`}
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
      <div className="flex items-center gap-3 px-4 py-3.5 bg-[#292b2f] rounded-b-lg">
        <div className="w-9 h-9 rounded-full bg-[#7289da] text-white flex items-center justify-center font-bold text-sm shrink-0">
          {currentNick[0]?.toUpperCase() ?? '?'}
        </div>
        <span className="text-[14px] font-semibold text-white truncate">{currentNick}</span>
      </div>
    </div>
  );
}
