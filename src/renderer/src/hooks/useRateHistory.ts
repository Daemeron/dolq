import { useEffect, useRef, useState } from 'react';

export type RateSample = { at: number; down: number; up: number };

/**
 * Samples the current transfer rates every `intervalMs` and keeps the latest `max`. The history lives in a ref so
 * sampling never re-renders the app; the returned copy updates only while `active` (the Dashboard is open).
 */
export function useRateHistory(rates: { down: number; up: number }, active: boolean, intervalMs = 2000, max = 150) {
  const latest = useRef(rates);
  latest.current = rates;
  const history = useRef<RateSample[]>([]);
  const [shown, setShown] = useState<RateSample[]>([]);

  useEffect(() => {
    const sample = () => {
      history.current = [
        ...history.current,
        { at: Date.now(), down: latest.current.down, up: latest.current.up },
      ].slice(-max);
      if (active) setShown(history.current);
    };
    if (active) setShown(history.current);
    const timer = setInterval(sample, intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, max]);

  return shown;
}
