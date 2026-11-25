"use client";

import { useCallback, useState, type SetStateAction } from "react";
import { cameBack } from "./back-navigation";

/**
 * useState that's put back when you return with Back (the month you were looking at, the tab you picked), like a
 * professional app. Arriving any other way (a link, the tab bar, opening the app) starts fresh from `initial`.
 * Only for parts rendered in the browser (not on the server), since the stored value is read on the first render.
 */
export function useSessionState<T>(key: string, initial: T): [T, (v: SetStateAction<T>) => void] {
  const storeKey = `mm:view:${key}`;
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      // Arrived fresh: start over, and forget the old choice so a later Back doesn't bring it back.
      if (!cameBack()) {
        window.sessionStorage.removeItem(storeKey);
        return initial;
      }
      const raw = window.sessionStorage.getItem(storeKey);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: SetStateAction<T>) => {
      setValue((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        try {
          window.sessionStorage.setItem(storeKey, JSON.stringify(next));
        } catch {
          /* private mode or full: it just won't be remembered */
        }
        return next;
      });
    },
    [storeKey],
  );
  return [value, set];
}
