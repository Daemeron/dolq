// An error retrying cannot fix (a changed certificate, a refused token): the
// redial loop gives up on it instead of trying again.
export class PermanentError extends Error {}

const BASE_MS = 1000;
const MAX_MS = 30_000;

// Doubles from 1s after each failed attempt, capped at 30s.
export function redialDelay(attempt: number): number {
  return Math.min(MAX_MS, BASE_MS * 2 ** attempt);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Calls dial until it succeeds, waiting redialDelay between attempts. Resolves
// true once connected, false if stopped() turned true first; rejects with the
// first PermanentError.
export async function redial(dial: () => Promise<void>, stopped: () => boolean): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    await sleep(redialDelay(attempt));
    if (stopped()) return false;
    try {
      await dial();
      return true;
    } catch (err) {
      if (err instanceof PermanentError) throw err;
      console.error('backend redial failed:', err);
    }
  }
}
