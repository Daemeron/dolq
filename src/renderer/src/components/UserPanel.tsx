import type { ConnectionStatus } from '../../../shared/ipc';
import { nickColor, nickInitial } from '../utils/nickColor';
import { Icon } from './Icon';

type Props = {
  currentNick: string;
  /** Whether this server is connected: "Online" only means something then. */
  status: ConnectionStatus;
  away: boolean;
  onToggleAway: () => void;
};

const IDLE_LABEL: Record<Exclude<ConnectionStatus, 'connected'>, string> = {
  connecting: 'Connecting…',
  disconnected: 'Offline',
};

export function UserPanel({ currentNick, status, away, onToggleAway }: Props) {
  const connected = status === 'connected';
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 shrink-0">
      <div
        className="w-7 h-7 rounded-full text-white flex items-center justify-center font-semibold text-xs shrink-0"
        style={{ background: away || !connected ? 'var(--dolq-text-faint)' : nickColor(currentNick) }}
      >
        {nickInitial(currentNick)}
      </div>
      <div className="flex-1 min-w-0 leading-tight">
        <div className="text-[13px] font-medium text-(--dolq-text) truncate">{currentNick}</div>
        <div className="text-[12px] text-(--dolq-text-dim)">
          {connected ? (away ? 'Away' : 'Online') : IDLE_LABEL[status]}
        </div>
      </div>
      <button
        type="button"
        onClick={onToggleAway}
        data-tip={away ? 'Back from away' : 'Set away'}
        aria-label={away ? 'Back from away' : 'Set away'}
        aria-pressed={away}
        // Away is set on the server, so there is nothing to set while it is not connected.
        disabled={!connected}
        className="has-tip shrink-0 w-8.5 h-8.5 flex items-center justify-center rounded-lg border-0 bg-transparent text-(--dolq-text-dim) cursor-pointer hover:text-(--dolq-text) hover:bg-(--dolq-bg-row-hover) aria-pressed:text-(--dolq-text) aria-pressed:bg-(--dolq-bg-row-selected) disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <Icon name="moon" />
      </button>
    </div>
  );
}
