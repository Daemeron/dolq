import { IconButton } from './Icon';

type Props = {
  onOpenSearch: () => void;
  onOpenPreferences: () => void;
  /** Away on every connected server at once. */
  away: boolean;
  awayDisabled: boolean;
  onToggleAway: () => void;
  transferCount: number;
  showTransfers: boolean;
  onToggleTransfers: () => void;
};

/** The strip above the whole app: it drags the window, holds the app-wide actions, and leaves the end to the OS window controls. */
export function TitleBar({
  onOpenSearch,
  onOpenPreferences,
  away,
  awayDisabled,
  onToggleAway,
  transferCount,
  showTransfers,
  onToggleTransfers,
}: Props) {
  return (
    <header
      // Off macOS the OS draws the window controls over the right end; on macOS the traffic lights take the left.
      className="titlebar-drag flex h-8 shrink-0 items-center gap-1 border-b border-(--dolq-border) bg-(--dolq-bg-panel-alt) pr-[calc(100vw-env(titlebar-area-x,0px)-env(titlebar-area-width,100vw)+0.5rem)] pl-3 in-data-[platform=mac]:pl-20"
    >
      <span className="flex-1 text-[12px] font-medium text-(--dolq-text-dim) select-none">Dolq</span>
      <div role="toolbar" aria-label="App actions" className="titlebar-nodrag flex items-center gap-0.5">
        <IconButton compact icon="search" label="Search everywhere" onClick={onOpenSearch} />
        <IconButton
          compact
          icon="download"
          label="Transfers"
          on={showTransfers}
          badge={transferCount > 0}
          onClick={onToggleTransfers}
        />
        <IconButton
          compact
          icon="moon"
          label={away ? 'Back from away on all servers' : 'Away on all servers'}
          on={away}
          onClick={awayDisabled ? () => undefined : onToggleAway}
        />
        <IconButton compact icon="sliders" label="Preferences" onClick={onOpenPreferences} />
      </div>
    </header>
  );
}
