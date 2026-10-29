import type { Message } from '../types';
import { summarizeRun } from '../utils/membershipGroups';
import { Icon } from './Icon';

type Props = {
  run: Message[];
  open: boolean;
  onToggle: () => void;
  formatTime: (d: Date) => string;
};

/** A run of joins, parts and quits folded into one line, so the conversation around it stays easy to follow. */
export function MembershipSummary({ run, open, onToggle, formatTime }: Props) {
  const first = formatTime(run[0].timestamp);
  const last = formatTime(run[run.length - 1].timestamp);
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="group flex w-full cursor-pointer items-baseline gap-3 border-0 bg-transparent px-7 py-1 text-left hover:bg-(--dolq-bg-row-hover)"
    >
      <span className="flex w-9 shrink-0 justify-end text-[11px] whitespace-nowrap text-(--dolq-text-faint) tabular-nums">
        {first}
      </span>
      <span className="min-w-0 flex-1 text-[13px] text-(--dolq-text-dim) italic">{summarizeRun(run)}</span>
      <span className="shrink-0 text-[11px] whitespace-nowrap text-(--dolq-text-faint)">
        {run.length} events{first === last ? '' : ` · until ${last}`}
      </span>
      <span className="shrink-0 self-center text-(--dolq-text-faint)">
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
      </span>
    </button>
  );
}
