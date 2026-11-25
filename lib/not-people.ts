import { useSyncExternalStore } from "react";
import { appStorage } from "@/lib/cloud/sync";

/** Names found in entries that the user said aren't people (a shop, a company): kept out of "Found in your entries". Synced. */
const KEY = "money-manager:v1:not-people";
const listeners = new Set<() => void>();
let cached: { raw: string | null; keys: ReadonlySet<string> } | null = null;
const EMPTY: ReadonlySet<string> = new Set();

function read(): ReadonlySet<string> {
  const raw = typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
  if (cached?.raw === raw) return cached.keys;
  let keys: ReadonlySet<string> = EMPTY;
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) keys = new Set(parsed.filter((k): k is string => typeof k === "string"));
  } catch {
    // Unreadable: nothing is hidden.
  }
  cached = { raw, keys };
  return keys;
}

export function hideFoundName(key: string) {
  appStorage.setItem(KEY, JSON.stringify([...new Set([...read(), key])]));
  for (const l of listeners) l();
}

export function useNotPeople(): ReadonlySet<string> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => EMPTY,
  );
}
