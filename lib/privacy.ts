import { useSyncExternalStore } from "react";

/**
 * Privacy mode hides every rupee amount behind dots, for using the app in public. It belongs to this
 * device, not the account, so it is kept in localStorage directly and never synced.
 */
const KEY = "money-manager:privacy";
const listeners = new Set<() => void>();
let hidden = false;
let loaded = false;

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    hidden = window.localStorage.getItem(KEY) === "1";
  } catch {
    // Storage blocked: privacy mode just starts off each visit.
  }
}

/** Plain read for the money formatters, which run outside React. */
export function isPrivate(): boolean {
  load();
  return hidden;
}

export function setPrivate(on: boolean) {
  load();
  hidden = on;
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Kept for this visit only.
  }
  for (const l of listeners) l();
}

export function usePrivate(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    isPrivate,
    () => false,
  );
}

/** What stands in for an amount while privacy mode is on. */
export const MASKED_AMOUNT = "₹ ••••";

/** The amount text as given, or the mask when privacy mode is on. */
export function shield(text: string): string {
  return isPrivate() ? MASKED_AMOUNT : text;
}
