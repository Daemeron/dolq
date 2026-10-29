import { useCallback, useEffect, useRef, useState } from 'react';
import { locationKey, type NavLocation, startHistory, step, visit } from '../utils/navHistory';

/**
 * Back and forward through the places visited in the main area. `current` is where the app is; `go` moves it
 * (the app applies the location) and `reachable` says whether an old entry still exists (a channel may be gone).
 */
export function useNavHistory(
  current: NavLocation,
  go: (to: NavLocation) => void,
  reachable: (l: NavLocation) => boolean,
) {
  const [history, setHistory] = useState(() => startHistory(current));
  const arrivingAt = useRef<string | null>(null);
  const key = locationKey(current);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `current` is described by `key`
  useEffect(() => {
    const ours = arrivingAt.current === key;
    arrivingAt.current = null;
    if (!ours) setHistory((h) => visit(h, current));
  }, [key]);

  const move = useCallback(
    (direction: -1 | 1) => {
      const index = step(history, direction, reachable);
      if (index === null) return;
      const target = history.entries[index];
      // Going to where we already are changes no key, so nothing would clear the mark.
      arrivingAt.current = locationKey(target) === key ? null : locationKey(target);
      setHistory({ ...history, index });
      go(target);
    },
    [history, go, reachable, key],
  );

  return {
    canGoBack: step(history, -1, reachable) !== null,
    canGoForward: step(history, 1, reachable) !== null,
    goBack: () => move(-1),
    goForward: () => move(1),
  };
}
