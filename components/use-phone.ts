"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 639px)"; // below Tailwind's `sm`

const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

/** True on phone-width screens, for sizes CSS can't set (a chart's height in pixels). False while rendering on the server. */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
