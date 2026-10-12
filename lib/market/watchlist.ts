import { useSyncExternalStore } from "react";
import { appStorage } from "@/lib/cloud/sync";
import { DEFAULT_WATCHLIST } from "./catalog";

/** The shares and funds the user follows on the Market page. Stored like the rest of the data, so it follows them to every device. */
const KEY = "money-manager:v1:market-watchlist";
const listeners = new Set<() => void>();
let cached: { raw: string | null; list: string[] } | null = null;

function read(): string[] {
  const raw = typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
  if (cached?.raw === raw) return cached.list;
  let list = DEFAULT_WATCHLIST;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) list = parsed.filter((s): s is string => typeof s === "string");
  } catch {
    // An unreadable list falls back to the starter one.
  }
  cached = { raw, list };
  return list;
}

function save(list: string[]) {
  appStorage.setItem(KEY, JSON.stringify(list));
  for (const l of listeners) l();
}

export const addToWatchlist = (symbol: string) => {
  const list = read();
  if (!list.includes(symbol)) save([...list, symbol]);
};
export const removeFromWatchlist = (symbol: string) => save(read().filter((s) => s !== symbol));

export function useWatchlist(): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => DEFAULT_WATCHLIST,
  );
}
