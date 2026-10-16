"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { CompanyRatios, MembersResponse, OverviewResponse } from "@/lib/market/types";

/**
 * Market data lives in this tab's memory only (nothing in localStorage): a reload starts afresh. Each URL
 * is fetched once however many components want it, shown at once when already in memory, and fetched
 * again once older than its max age — checked every 15 seconds while the page is visible.
 */
const PRICES_MAX_AGE = 60_000;
const RATIOS_MAX_AGE = 6 * 3600_000;

interface Snapshot<T> {
  data: T | null;
  at: number | null;
  error: boolean;
}
const EMPTY: Snapshot<never> = { data: null, at: null, error: false };
const entries = new Map<string, { snap: Snapshot<unknown>; inFlight: boolean; subs: Set<() => void> }>();

function entry(url: string) {
  let e = entries.get(url);
  if (!e) entries.set(url, (e = { snap: EMPTY, inFlight: false, subs: new Set() }));
  return e;
}

async function load(url: string) {
  const e = entry(url);
  if (e.inFlight) return;
  e.inFlight = true;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    e.snap = { data: await res.json(), at: Date.now(), error: false };
  } catch {
    e.snap = { ...e.snap, error: true };
  } finally {
    e.inFlight = false;
    e.subs.forEach((f) => f());
  }
}

export interface Fetched<T> {
  data: T | null;
  status: "loading" | "ready" | "error";
  /** The latest refresh failed, so `data` is older than it should be. */
  stale: boolean;
  retry: () => void;
}

function useMemoryJson<T>(url: string | null, maxAgeMs: number): Fetched<T> {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!url) return () => {};
      const e = entry(url);
      e.subs.add(cb);
      return () => e.subs.delete(cb);
    },
    [url],
  );
  const snap = useSyncExternalStore(
    subscribe,
    () => (url ? entry(url).snap : EMPTY),
    () => EMPTY,
  ) as Snapshot<T>;

  useEffect(() => {
    if (!url) return;
    const stale = () => {
      const s = entry(url).snap;
      return !s.at || Date.now() - s.at > maxAgeMs;
    };
    if (stale()) void load(url);
    const check = () => document.visibilityState === "visible" && stale() && void load(url);
    document.addEventListener("visibilitychange", check);
    const timer = window.setInterval(check, 15_000);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.clearInterval(timer);
    };
  }, [url, maxAgeMs]);

  return { data: snap.data, status: snap.data ? "ready" : snap.error ? "error" : "loading", stale: !!snap.data && snap.error, retry: () => url && void load(url) };
}

export const useOverview = () => useMemoryJson<OverviewResponse>("/api/market/overview", PRICES_MAX_AGE);

/** An index's or sector's companies; nothing is fetched until one is opened. */
export const useMembers = (symbol: string | null) => useMemoryJson<MembersResponse>(symbol ? `/api/market/members?symbol=${encodeURIComponent(symbol)}` : null, PRICES_MAX_AGE);

export const useRatios = (symbol: string | null) => useMemoryJson<CompanyRatios>(symbol ? `/api/market/company?symbol=${encodeURIComponent(symbol)}` : null, RATIOS_MAX_AGE);
