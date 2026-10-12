"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NewsResponse } from "@/lib/market/news";
import type { ChartData, EconomyResponse, MarketRange, QuotesResponse, SearchHit, SectorResponse } from "@/lib/market/types";

/**
 * Market data isn't for trading here, so nothing polls. A page shows what this browser last fetched
 * straight away, and only asks the server again once that's older than `maxAgeMs` (or on Refresh).
 * The server and its CDN keep answers for a while too, so most of these never reach Yahoo or the IMF.
 */
/** Bumped when an answer gains or changes fields (v2: economies gained group, reserves, budget, income, size; v3: seven years of history). */
const CACHE_VERSION = 3;
const PRICES_MAX_AGE = 30 * 60_000;
const ECONOMY_MAX_AGE = 12 * 60 * 60_000;

interface Saved<T> {
  at: number;
  data: T;
}

function readSaved<T>(key: string): Saved<T> | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Saved<T>) : null;
  } catch {
    return null;
  }
}

function writeSaved(key: string, data: unknown) {
  try {
    // Not app data: a throwaway copy kept only in this browser (the "mm-" prefix keeps it out of cloud sync).
    window.localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // Storage full or blocked: the page still works, it just fetches next time.
  }
}

export interface Fetched<T> {
  data: T | null;
  status: "loading" | "ready" | "error";
  /** When the data shown was fetched, in ms. */
  at: number | null;
  refreshing: boolean;
  refresh: () => void;
}

/** `maxAgeMs` may depend on the data: an incomplete answer is worth asking again for sooner. */
function useCachedJson<T>(url: string | null, maxAgeMs: number | ((data: T) => number)): Fetched<T> {
  // The version changes whenever the answers change shape, so a copy saved by an older version is never read back.
  const key = url ? `mm-market-cache:${CACHE_VERSION}:${url}` : "";
  const [state, setState] = useState<{ key: string; data: T | null; at: number | null; error: boolean }>({ key: "", data: null, at: null, error: false });
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!url || inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      // Past the browser's own HTTP cache: this hook keeps its own copy, and an old one there could outlive a change of shape.
      // Shared CDN copies still answer, so this costs nothing extra.
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = (await res.json()) as T;
      writeSaved(key, data);
      setState({ key, data, at: Date.now(), error: false });
    } catch {
      setState((s) => (s.key === key && s.data ? s : { key, data: null, at: null, error: true }));
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [url, key]);

  useEffect(() => {
    if (!url) return;
    const stale = (s: Saved<T> | null) => !s || Date.now() - s.at > (typeof maxAgeMs === "number" ? maxAgeMs : maxAgeMs(s.data));
    const saved = readSaved<T>(key);
    if (saved) setState({ key, data: saved.data, at: saved.at, error: false });
    if (stale(saved)) void load();
    // Coming back to the app after a long while: fetch again then, not on a timer.
    const onVisible = () => document.visibilityState === "visible" && stale(readSaved<T>(key)) && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [url, key, maxAgeMs, load]);

  const current = state.key === key;
  return {
    data: current ? state.data : null,
    status: current && state.data ? "ready" : current && state.error ? "error" : "loading",
    at: current ? state.at : null,
    refreshing,
    refresh: () => void load(),
  };
}

export const useOverview = (enabled = true) => useCachedJson<QuotesResponse>(enabled ? "/api/market/overview" : null, PRICES_MAX_AGE);

export const useWatchlistQuotes = (symbols: string[]) =>
  useCachedJson<QuotesResponse>(symbols.length ? `/api/market/quotes?symbols=${encodeURIComponent([...symbols].sort().join(","))}` : null, PRICES_MAX_AGE);

/** Important finance news, fetched only once the News view is opened; kept half an hour. */
export const useNews = (enabled = true) => useCachedJson<NewsResponse>(enabled ? "/api/market/news" : null, PRICES_MAX_AGE);

/** A sector's stocks, fetched only once the sector is opened. */
export const useSector = (symbol: string | null) =>
  useCachedJson<SectorResponse>(symbol ? `/api/market/sector?symbol=${encodeURIComponent(symbol)}` : null, PRICES_MAX_AGE);

const economyMaxAge = (d: EconomyResponse) => (d.complete ? ECONOMY_MAX_AGE : 10 * 60_000);
export const useEconomy = (enabled = true) => useCachedJson<EconomyResponse>(enabled ? "/api/market/economy" : null, economyMaxAge);

const charts = new Map<string, { at: number; data: ChartData }>();

/** The price over a range, for the big chart; kept for the visit (a long range barely moves in a session). */
export function useChart(symbol: string | null, range: MarketRange) {
  const key = symbol ? `${symbol}|${range}` : "";
  const [state, setState] = useState<{ key: string; data: ChartData | null; error: boolean }>({ key: "", data: null, error: false });

  useEffect(() => {
    if (!symbol) return;
    const hit = charts.get(key);
    if (hit && Date.now() - hit.at < PRICES_MAX_AGE) {
      setState({ key, data: hit.data, error: false });
      return;
    }
    let alive = true;
    fetch(`/api/market/chart?symbol=${encodeURIComponent(symbol)}&range=${range}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("No chart");
        const data = (await res.json()) as ChartData;
        charts.set(key, { at: Date.now(), data });
        if (alive) setState({ key, data, error: false });
      })
      .catch(() => alive && setState({ key, data: null, error: true }));
    return () => {
      alive = false;
    };
  }, [symbol, range, key]);

  const current = state.key === key;
  return { data: current ? state.data : null, loading: !!symbol && !current, error: current && state.error };
}

/** Search as you type, a moment after the typing stops. */
export function useSearch(q: string) {
  const query = q.trim().toLowerCase();
  const [state, setState] = useState<{ q: string; hits: SearchHit[]; error: boolean }>({ q: "", hits: [], error: false });

  useEffect(() => {
    if (query.length < 2) return;
    let alive = true;
    const timer = setTimeout(() => {
      fetch(`/api/market/search?q=${encodeURIComponent(query)}`)
        .then(async (res) => {
          const body = (await res.json()) as { hits?: SearchHit[] };
          if (!res.ok || !body.hits) throw new Error("Search failed");
          if (alive) setState({ q: query, hits: body.hits, error: false });
        })
        .catch(() => alive && setState({ q: query, hits: [], error: true }));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  const current = state.q === query;
  return { hits: current ? state.hits : [], searching: query.length >= 2 && !current, error: current && state.error };
}
