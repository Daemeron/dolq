import type { Message } from '../types';
import type { MembershipKind } from './eventMessages';

// Fewer than this in a row are shown as they are; a longer run is worth folding into one line.
export const MIN_RUN = 3;

const sameDay = (a: Message, b: Message) => a.timestamp.toDateString() === b.timestamp.toDateString();

export type MembershipRuns = {
  /** Runs of consecutive join/part/quit/nick lines, by the id of the run's first message. */
  runs: Map<number, Message[]>;
  /** Every message of a run except the first, mapped to the id of the run's first message. */
  followers: Map<number, number>;
};

/** Finds runs of membership lines (within one day, so a day divider is never folded away). */
export function membershipRuns(messages: Message[]): MembershipRuns {
  const runs = new Map<number, Message[]>();
  const followers = new Map<number, number>();
  let run: Message[] = [];
  const close = () => {
    if (run.length >= MIN_RUN) {
      runs.set(run[0].id, run);
      for (const m of run.slice(1)) followers.set(m.id, run[0].id);
    }
    run = [];
  };
  for (const m of messages) {
    if (!m.membership) {
      close();
      continue;
    }
    if (run.length > 0 && !sameDay(run[run.length - 1], m)) close();
    run.push(m);
  }
  close();
  return { runs, followers };
}

/** True for a line that is folded away entirely: part of a run, but not its first line, while the run is closed. */
export function hiddenByFold(followers: Map<number, number>, id: number, isOpen: (firstId: number) => boolean) {
  const first = followers.get(id);
  return first !== undefined && !isOpen(first);
}

const WORDS: Record<MembershipKind, string> = {
  join: 'joined',
  part: 'left',
  quit: 'quit',
  nick: 'changed nick',
};
const ORDER: MembershipKind[] = ['join', 'part', 'quit', 'nick'];
const NAMES_SHOWN = 3;

// Nicks never contain spaces, and every membership line starts with the nick it is about.
const nickOf = (m: Message) => m.text.split(' ')[0];

function nameList(nicks: string[]): string {
  const unique = [...new Set(nicks)];
  if (unique.length === 1) return unique[0];
  if (unique.length <= NAMES_SHOWN) return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
  const others = unique.length - (NAMES_SHOWN - 1);
  return `${unique.slice(0, NAMES_SHOWN - 1).join(', ')} and ${others} others`;
}

/** One line for a run: who joined, who left, who quit, who changed nick. */
export function summarizeRun(run: Message[]): string {
  return ORDER.flatMap((kind) => {
    const nicks = run.filter((m) => m.membership === kind).map(nickOf);
    return nicks.length === 0 ? [] : [`${nameList(nicks)} ${WORDS[kind]}`];
  }).join(' · ');
}
