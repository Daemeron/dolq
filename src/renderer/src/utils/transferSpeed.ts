export type SpeedTrack = { received: number; at: number };

// Progress events arrive in bursts (the app can be busy for a moment, then see several at once), so the time
// between two of them says nothing about speed. Measure over at least this long instead.
const WINDOW_MS = 1000;

/** Folds a progress event in. `speedBps` is set only when a full window has passed since the baseline. */
export function updateSpeed(
  track: SpeedTrack | undefined,
  received: number,
  now: number,
): { track: SpeedTrack; speedBps?: number } {
  if (!track) return { track: { received, at: now } };
  const elapsed = now - track.at;
  if (elapsed < WINDOW_MS) return { track };
  return { track: { received, at: now }, speedBps: (Math.max(0, received - track.received) / elapsed) * 1000 };
}
