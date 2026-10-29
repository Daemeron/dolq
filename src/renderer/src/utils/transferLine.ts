import { formatBytes } from './bytes';

type Progress = {
  nick: string;
  received: number;
  total: number;
  paused?: boolean;
  speedBps?: number;
  sending?: boolean;
};

export const transferPercent = (t: { received: number; total: number }) =>
  t.total > 0 ? Math.min(100, Math.round((t.received / t.total) * 100)) : 0;

/** The status line of a transfer that is still going: who it is with, how far along, how fast. */
export function activeLine(t: Progress): string {
  const pct = transferPercent(t);
  const of = `${pct}% of ${formatBytes(t.total)}`;
  if (t.sending) return t.total > 0 ? `Sending to ${t.nick} · ${of}` : `Waiting for ${t.nick} to connect`;
  if (t.paused) return `${t.nick} · ${of} · paused`;
  return `${t.nick} · ${of}${t.speedBps ? ` · ${formatBytes(t.speedBps)}/s` : ''}`;
}
