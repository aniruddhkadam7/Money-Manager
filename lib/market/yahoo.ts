import { z } from "zod";
import type { MarketKind, MarketRange, PricePoint, SearchHit } from "./types";

/**
 * Yahoo Finance's public chart and search endpoints: no key, NSE and BSE shares, Indian and world
 * indices, bond yields, futures (gold, silver, crude), currencies and crypto. They're unofficial, so
 * everything is parsed defensively, and Indian prices may be up to 15 minutes behind.
 */
const BASE = "https://query1.finance.yahoo.com";
const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; MoneyManager/1.0)", accept: "application/json" };

/** The bar size Yahoo is asked for, per range: enough points for a smooth line, not thousands. */
const INTERVAL: Record<MarketRange, string> = { "1d": "5m", "5d": "15m", "1mo": "1d", "6mo": "1d", "1y": "1d", "5y": "1wk" };

const Num = z.number().finite();
const Meta = z.object({
  symbol: z.string(),
  currency: z.string().nullish(),
  regularMarketPrice: Num,
  chartPreviousClose: Num.nullish(),
  fiftyTwoWeekHigh: Num.nullish(),
  fiftyTwoWeekLow: Num.nullish(),
  regularMarketTime: Num.nullish(),
  gmtoffset: Num.nullish(),
  longName: z.string().nullish(),
  shortName: z.string().nullish(),
  instrumentType: z.string().nullish(),
  fullExchangeName: z.string().nullish(),
  exchangeTimezoneName: z.string().nullish(),
});
const ChartJson = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: Meta,
          timestamp: z.array(Num).nullish(),
          indicators: z.object({ quote: z.array(z.object({ close: z.array(Num.nullable()).nullish() })) }),
        }),
      )
      .nullish(),
  }),
});
const SearchJson = z.object({
  quotes: z
    .array(
      z.object({
        symbol: z.string().nullish(),
        shortname: z.string().nullish(),
        longname: z.string().nullish(),
        exchDisp: z.string().nullish(),
        quoteType: z.string().nullish(),
      }),
    )
    .nullish(),
});

const KINDS: Record<string, MarketKind> = {
  INDEX: "index",
  EQUITY: "equity",
  ETF: "etf",
  MUTUALFUND: "fund",
  FUTURE: "commodity",
  CURRENCY: "currency",
  CRYPTOCURRENCY: "crypto",
};

export interface ParsedChart {
  symbol: string;
  name: string;
  kind: MarketKind;
  currency: string | null;
  price: number;
  /** Only meaningful for a one-day chart: the close before the range starts. */
  chartPrevClose: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  /** When the price was last updated, in seconds. */
  time: number;
  /** The exchange's offset from UTC in seconds, for telling its days apart. */
  gmtoffset: number;
  exchange: string | null;
  timezone: string;
  /** Closes that have a price, oldest first (gaps dropped). */
  points: PricePoint[];
}

export function parseChart(json: unknown): ParsedChart {
  const result = ChartJson.parse(json).chart.result?.[0];
  if (!result) throw new Error("No data for that symbol");
  const m = result.meta;
  const times = result.timestamp ?? [];
  const closes = result.indicators.quote[0]?.close ?? [];
  const points: PricePoint[] = [];
  times.forEach((t, i) => {
    const v = closes[i];
    if (typeof v === "number") points.push({ t, v });
  });
  return {
    symbol: m.symbol,
    // The long name is in normal case ("Reliance Industries Limited"); the short one is often in capitals.
    name: m.longName || m.shortName || m.symbol,
    // Yahoo files yields (^TNX) as indices; they're percentages.
    kind: /^\^(IRX|FVX|TNX|TYX)$/.test(m.symbol) ? "yield" : (KINDS[m.instrumentType ?? ""] ?? "equity"),
    currency: m.currency ?? null,
    price: m.regularMarketPrice,
    chartPrevClose: m.chartPreviousClose ?? null,
    yearHigh: m.fiftyTwoWeekHigh ?? null,
    yearLow: m.fiftyTwoWeekLow ?? null,
    time: m.regularMarketTime ?? points.at(-1)?.t ?? 0,
    gmtoffset: m.gmtoffset ?? 0,
    exchange: m.fullExchangeName ?? null,
    timezone: m.exchangeTimezoneName ?? "Asia/Kolkata",
    points,
  };
}

/** Search results Yahoo can chart, Indian listings first. */
export function parseSearch(json: unknown): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const q of SearchJson.parse(json).quotes ?? []) {
    const kind = KINDS[q.quoteType ?? ""];
    if (!q.symbol || !kind) continue;
    hits.push({ symbol: q.symbol, name: q.longname || q.shortname || q.symbol, exchange: q.exchDisp ?? null, kind });
  }
  const indian = (h: SearchHit) => (/\.(NS|BO)$/.test(h.symbol) || h.symbol.startsWith("^") ? 0 : 1);
  return hits.map((h, i) => ({ h, i })).sort((a, b) => indian(a.h) - indian(b.h) || a.i - b.i).map(({ h }) => h);
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Yahoo answered ${res.status}`);
  return res.json();
}

export async function fetchYahooChart(symbol: string, range: MarketRange): Promise<ParsedChart> {
  const url = `${BASE}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${INTERVAL[range]}`;
  return parseChart(await getJson(url));
}

/**
 * Yahoo's quote endpoint (for company sizes) wants a session: a cookie from fc.yahoo.com and a "crumb"
 * that goes with it. Both last a long while, so one is kept for the day.
 */
let session: { cookie: string; crumb: string; at: number } | null = null;

async function yahooSession(): Promise<{ cookie: string; crumb: string }> {
  if (session && Date.now() - session.at < 24 * 3600_000) return session;
  const first = await fetch("https://fc.yahoo.com", { headers: HEADERS, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const cookie = first.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("No Yahoo session");
  // Plain text, not JSON: asking for JSON gets a 406.
  const res = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { "user-agent": HEADERS["user-agent"], accept: "*/*", cookie }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const crumb = (await res.text()).trim();
  if (!res.ok || !crumb || crumb.length > 40 || /[<{\s]/.test(crumb)) throw new Error("No Yahoo crumb");
  session = { cookie, crumb, at: Date.now() };
  return session;
}

const FundamentalsJson = z.object({
  quoteResponse: z.object({
    result: z
      .array(
        z.object({
          symbol: z.string(),
          sharesOutstanding: Num.nullish(),
          marketCap: Num.nullish(),
          trailingPE: Num.nullish(),
          epsTrailingTwelveMonths: Num.nullish(),
        }),
      )
      .nullish(),
  }),
});

export interface Fundamentals {
  shares: number | null;
  /** Company (or fund) value in its own currency. */
  marketCap: number | null;
  /** Price ÷ the last four quarters' earnings per share, as Yahoo reports it; Yahoo leaves it out for loss-makers. */
  pe: number | null;
  /** The last four quarters' earnings per share; negative for a loss. */
  eps: number | null;
}

/** Share counts, company values, PEs and earnings, 50 symbols a request. Symbols Yahoo doesn't know are left out. */
export async function fetchFundamentals(symbols: string[]): Promise<Record<string, Fundamentals>> {
  const { cookie, crumb } = await yahooSession();
  const out: Record<string, Fundamentals> = {};
  const positive = (v: number | null | undefined) => (v && v > 0 ? v : null);
  for (let i = 0; i < symbols.length; i += 50) {
    const batch = symbols.slice(i, i + 50).map(encodeURIComponent).join(",");
    const fields = "sharesOutstanding,marketCap,trailingPE,epsTrailingTwelveMonths";
    const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${batch}&fields=${fields}&crumb=${encodeURIComponent(crumb)}`;
    const res = await fetch(url, { headers: { ...HEADERS, cookie }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) session = null;
      throw new Error(`Yahoo answered ${res.status}`);
    }
    for (const q of FundamentalsJson.parse(await res.json()).quoteResponse.result ?? []) {
      out[q.symbol] = {
        shares: positive(q.sharesOutstanding),
        marketCap: positive(q.marketCap),
        pe: positive(q.trailingPE),
        eps: q.epsTrailingTwelveMonths ?? null,
      };
    }
  }
  return out;
}

/** How many shares each company has, for weighting an index by company size. Missing ones are left out. */
export async function fetchShares(symbols: string[]): Promise<Record<string, number>> {
  const all = await fetchFundamentals(symbols);
  return Object.fromEntries(Object.entries(all).flatMap(([s, f]) => (f.shares ? [[s, f.shares]] : [])));
}

export async function searchYahoo(q: string): Promise<SearchHit[]> {
  const url = `${BASE}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0`;
  return parseSearch(await getJson(url));
}
