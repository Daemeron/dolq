type Rated = { speedBps?: number; sending?: boolean; done?: boolean; error?: string; paused?: boolean };

/** What is flowing right now: the summed speed of the transfers that are still running, split into incoming and outgoing. */
export function transferRates(transfers: Rated[]): { down: number; up: number; active: number } {
  let down = 0;
  let up = 0;
  let active = 0;
  for (const t of transfers) {
    if (t.done || t.error) continue;
    active++;
    if (t.paused) continue;
    if (t.sending) up += t.speedBps ?? 0;
    else down += t.speedBps ?? 0;
  }
  return { down, up, active };
}
