import { useSyncExternalStore, useState, useEffect } from "react";
import { getBus, BusState } from "./bus.js";

export function useBusState(): BusState {
  return useSyncExternalStore(
    (cb) => getBus().subscribe(cb),
    () => getBus().getState(),
    () => getBus().getState(),
  );
}

/**
 * Returns the number of seconds elapsed since `since` (epoch ms),
 * formatted as "M:SS". Re-renders every second while mounted.
 */
export function useElapsed(since: number): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const total = Math.max(0, Math.floor((now - since) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
