type Props = {
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  onConnect: () => void;
  onDisconnect: () => void;
};

export function ConnectionStatus({ connectionStatus, onConnect, onDisconnect }: Props) {
  const btnColor =
    connectionStatus === 'connected'
      ? 'bg-[#50fa7b] hover:bg-[#ff5555]'
      : connectionStatus === 'connecting'
        ? 'bg-[var(--dolq-text-faint)] cursor-not-allowed'
        : 'bg-[var(--dolq-text-faint)] hover:bg-[#50fa7b]';

  return (
    <button
      type="button"
      onClick={
        connectionStatus === 'connecting' ? undefined : connectionStatus === 'connected' ? onDisconnect : onConnect
      }
      disabled={connectionStatus === 'connecting'}
      className={`group w-full px-4 py-3.5 rounded-lg shrink-0 border-b border-(--dolq-border) text-sm font-medium text-white text-shadow-sm leading-8.75 transition-colors ${btnColor}`}
    >
      {connectionStatus === 'connecting' ? (
        'Connecting…'
      ) : connectionStatus === 'connected' ? (
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
