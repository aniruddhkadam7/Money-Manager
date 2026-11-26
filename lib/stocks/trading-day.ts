"use client";

import { marketOpen } from "./market-hours";

/**
 * Whether the market is trading right now: within market hours, and the NIFTY 50 index has traded today (so not a
 * weekend or an exchange holiday). No holiday list to keep up: the index's last trade time says. Checked at most
 * every 10 minutes until the day's first trade is seen, then trusted for the rest of the day.
 */
const istDay = (d: Date = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
let cache: { day: string; traded: boolean; at: number } | null = null;
let inFlight: Promise<boolean> | null = null;

export function refreshTradingDay(): Promise<boolean> {
  if (!marketOpen()) return Promise.resolve(false);
  const day = istDay();
  if (cache?.day === day && (cache.traded || Date.now() - cache.at < 10 * 60_000)) return Promise.resolve(cache.traded);
  inFlight ??= fetch("/api/stocks/ltp?symbols=%5ENSEI")
    .then(async (res) => {
      const data = (await res.json()) as { prices?: Record<string, { time?: number }> };
      const t = data.prices?.["^NSEI"]?.time;
      const traded = !!t && istDay(new Date(t * 1000)) === day;
      cache = { day, traded, at: Date.now() };
      return traded;
    })
    .catch(() => (cache?.day === day ? cache.traded : false))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** The latest answer without asking again (false until known). */
export const tradingNow = () => marketOpen() && cache?.day === istDay() && cache.traded;
