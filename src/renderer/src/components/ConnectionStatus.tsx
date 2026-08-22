type Props = {
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  onConnect: () => void;
  onDisconnect: () => void;
};

// Split out of UserPanel - this sits at the top of the right-hand column,
// above UserList, while the nick/avatar/preferences part of the old
// combined panel stays put at the bottom of the server rail.
export function ConnectionStatus({ connectionStatus, onConnect, onDisconnect }: Props) {
  const btnColor = connectionStatus === 'connected'
    ? 'bg-[#50fa7b] hover:bg-[#ff5555]'
    : connectionStatus === 'connecting'
    ? 'bg-[var(--dolq-text-faint)] cursor-not-allowed'
    : 'bg-[var(--dolq-text-faint)] hover:bg-[#50fa7b]';

  return (
    <button
      onClick={connectionStatus === 'connecting' ? undefined : connectionStatus === 'connected' ? onDisconnect : onConnect}
      disabled={connectionStatus === 'connecting'}
      className={`group w-full py-2.5 shrink-0 border-b border-[var(--dolq-border)] text-sm font-medium text-white text-shadow-sm transition-colors ${btnColor}`}
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
  );
}
