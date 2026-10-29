import { useState } from 'react';
import { IconButton } from './Icon';
import type { Transfer } from './TransferStatus';
import { TransfersPeek } from './TransfersPeek';

type Props = {
  /** Where you are: shown in the middle. */
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  onOpenSearch: () => void;
  onOpenPreferences: () => void;
  /** Away on every connected server at once. */
  away: boolean;
  awayDisabled: boolean;
  onToggleAway: () => void;
  transfers: Record<string, Transfer>;
  showTransfers: boolean;
  onToggleTransfers: () => void;
};

const NAV_BUTTON_OFF = 'pointer-events-none opacity-35';

/** The strip above the whole app: back and forward, where you are, and the app-wide actions. The OS draws the window controls at the end. */
export function TitleBar({
  title,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onOpenSearch,
  onOpenPreferences,
  away,
  awayDisabled,
  onToggleAway,
  transfers,
  showTransfers,
  onToggleTransfers,
}: Props) {
  const [peek, setPeek] = useState(false);
  const transferCount = Object.keys(transfers).length;
  return (
    <header
      // Off macOS the OS draws the window controls over the right end; on macOS the traffic lights take the left.
      className="titlebar-drag relative flex h-8 shrink-0 items-center gap-1 border-b border-(--dolq-border) bg-(--dolq-bg-panel-alt) pr-[calc(100vw-env(titlebar-area-x,0px)-env(titlebar-area-width,100vw)+0.5rem)] pl-2 in-data-[platform=mac]:pl-20"
    >
      <div role="toolbar" aria-label="History" className="titlebar-nodrag flex items-center gap-0.5">
        <span className={canGoBack ? '' : NAV_BUTTON_OFF}>
          <IconButton compact icon="arrowLeft" label="Back" onClick={onGoBack} />
        </span>
        <span className={canGoForward ? '' : NAV_BUTTON_OFF}>
          <IconButton compact icon="arrowRight" label="Forward" onClick={onGoForward} />
        </span>
      </div>
      <span className="pointer-events-none absolute left-1/2 m-0 max-w-[40%] -translate-x-1/2 truncate text-[12px] font-medium text-(--dolq-text-dim) select-none">
        {title}
      </span>
      <div className="flex-1" />
      <div role="toolbar" aria-label="App actions" className="titlebar-nodrag flex items-center gap-0.5">
        <IconButton compact icon="search" label="Search everywhere" onClick={onOpenSearch} />
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only listens for hover and focus on the button inside it */}
        <div
          className="relative"
          onMouseEnter={() => setPeek(true)}
          onMouseLeave={() => setPeek(false)}
          onFocus={() => setPeek(true)}
          onBlur={() => setPeek(false)}
        >
          <IconButton
            compact
            icon="download"
            label="Transfers"
            on={showTransfers}
            badge={transferCount > 0}
            onClick={onToggleTransfers}
          />
          {peek && !showTransfers && <TransfersPeek transfers={transfers} />}
        </div>
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
