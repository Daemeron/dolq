import type { Message } from '../types';

export const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Plain chat lines are the only ones that group; events, notices, actions and pack lists keep their own row. */
function isPlain(m: Message): boolean {
  return !m.isRaw && !m.system && !m.notice && !m.action && !m.xdccPack;
}

/**
 * True when `m` continues `prev`'s group: same sender, both plain chat lines, and
 * sent within five minutes of the previous line (not of the group's first line,
 * so a steady conversation stays one group).
 */
export function continuesGroup(prev: Message | undefined, m: Message): boolean {
  if (!prev || !isPlain(prev) || !isPlain(m)) return false;
  if (prev.nick !== m.nick) return false;
  const gap = m.timestamp.getTime() - prev.timestamp.getTime();
  return gap >= 0 && gap <= GROUP_WINDOW_MS;
}
