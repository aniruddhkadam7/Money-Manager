import { z } from "zod";
import { dailySpark, performance } from "./perf";
import type { ChartData, MarketRange, PricePoint, Quote, SearchHit } from "./types";

/**
 * Indian mutual funds from mfapi.in: AMFI's official NAVs, free, one price per fund per working day.
 * A fund's symbol in the app is "MF:" and its AMFI scheme code, e.g. MF:122639.
 */
const BASE = "https://api.mfapi.in";
export const FUND_PREFIX = "MF:";

export const isFund = (symbol: string) => symbol.startsWith(FUND_PREFIX);

const History = z.object({
  meta: z.object({ scheme_name: z.string(), fund_house: z.string().nullish() }),
  data: z.array(z.object({ date: z.string(), nav: z.string() })),
});
const Search = z.array(z.object({ schemeCode: z.number(), schemeName: z.string() }));

/** "09-10-2026" -> seconds at midnight UTC that day. */
function dayToSeconds(date: string): number {
  const [d, m, y] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 1000;
}

export interface FundHistory {
  name: string;
  house: string | null;
  /** Oldest first. */
  points: PricePoint[];
}

export function parseFundHistory(json: unknown): FundHistory {
  const h = History.parse(json);
  const points = h.data
    .map((r) => ({ t: dayToSeconds(r.date), v: Number(r.nav) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 0)
    .sort((a, b) => a.t - b.t);
  if (!points.length) throw new Error("No NAVs for that fund");
  return { name: h.meta.scheme_name, house: h.meta.fund_house ?? null, points };
}

export function fundQuote(symbol: string, h: FundHistory): Quote {
  const last = h.points[h.points.length - 1];
  const prev = h.points[h.points.length - 2] ?? last;
  const year = h.points.filter((p) => p.t >= last.t - 365 * 86_400).map((p) => p.v);
  return {
    symbol,
    name: h.name,
    kind: "fund",
    currency: "INR",
    price: last.v,
    prevClose: prev.v,
    change: last.v - prev.v,
    changePct: prev.v ? ((last.v - prev.v) / prev.v) * 100 : 0,
    perf: performance(h.points, last.v, prev.v),
    yearHigh: Math.max(...year),
    yearLow: Math.min(...year),
    time: last.t,
    exchange: h.house,
    timezone: "Asia/Kolkata",
    spark: dailySpark(h.points),
    note: "NAV, published once a day after markets close",
  };
}

const RANGE_DAYS: Record<MarketRange, number> = { "1d": 30, "5d": 30, "1mo": 31, "6mo": 183, "1y": 366, "5y": 1827 };

export function fundChart(symbol: string, range: MarketRange, h: FundHistory): ChartData {
  const last = h.points[h.points.length - 1].t;
  let points = h.points.filter((p) => p.t >= last - RANGE_DAYS[range] * 86_400);
  // Five years of days is ~1,200 points; every third keeps the line's shape.
  if (points.length > 400) points = points.filter((_, i) => i % 3 === 0 || i === points.length - 1);
  return { symbol, range, timezone: "Asia/Kolkata", points, prevClose: null };
}

export async function fetchFundHistory(symbol: string): Promise<FundHistory> {
  const code = symbol.slice(FUND_PREFIX.length);
  if (!/^\d{1,8}$/.test(code)) throw new Error("Not a fund code");
  const res = await fetch(`${BASE}/mf/${code}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`mfapi answered ${res.status}`);
  return parseFundHistory(await res.json());
}

/** Funds matching the words, growth plans first (they're what most people hold). */
export async function searchFunds(q: string): Promise<SearchHit[]> {
  const res = await fetch(`${BASE}/mf/search?q=${encodeURIComponent(q)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`mfapi answered ${res.status}`);
  const growth = (name: string) => (/growth/i.test(name) ? 0 : 1);
  return Search.parse(await res.json())
    .sort((a, b) => growth(a.schemeName) - growth(b.schemeName))
    .slice(0, 8)
    .map((f) => ({ symbol: `${FUND_PREFIX}${f.schemeCode}`, name: f.schemeName, exchange: "Mutual fund", kind: "fund" as const }));
}
