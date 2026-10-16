import { BY_SYMBOL, INDICES, SECTORS, type IndexItem } from "./catalog";
import { fetchConstituents } from "./constituents";
import type { CompanyRatios, IndexQuote, Member, MembersResponse, OverviewResponse } from "./types";
import { fetchQuotes, fetchRatios, type QuoteFields } from "./yahoo";

/**
 * The server side of the Market page: a stateless go-between for Yahoo and NSE, which a browser can't
 * call itself. Nothing is stored: answers are kept in this process's memory for a short while so page
 * views share one request to the source. When a refresh fails, the last good answer is served.
 */
interface Entry {
  until: number;
  value: Promise<unknown>;
  good?: unknown;
}
const store = new Map<string, Entry>();

function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() < hit.until) return hit.value as Promise<T>;
  const entry: Entry = { until: Date.now() + ttlMs, value: Promise.resolve(), good: hit?.good };
  entry.value = load().then(
    (v) => (entry.good = v),
    (err) => {
      if (entry.good === undefined) {
        store.delete(key);
        throw err;
      }
      // Try the source again in a minute; meanwhile the last good answer.
      entry.until = Date.now() + 60_000;
      return entry.good;
    },
  );
  store.set(key, entry);
  if (store.size > 1000) store.delete(store.keys().next().value!);
  return entry.value as Promise<T>;
}

/** Prices: a minute (Yahoo's are 15 minutes behind anyway). Ratios: six hours. NSE's lists: a week (reviewed twice a year). */
export const PRICE_TTL_S = 60;
export const RATIOS_TTL_S = 6 * 3600;
const LIST_TTL_MS = 7 * 24 * 3600_000;

const positive = (v: number | null | undefined) => (v != null && v > 0 ? v : null);

/** Today's change in points, from the price and the change percent (Yahoo's previous-close field can lag a day for indices). */
const pointsChange = (price: number, pct: number | null | undefined) => (pct == null || pct <= -100 ? null : price - price / (1 + pct / 100));

export function indexQuote(item: IndexItem, q: QuoteFields): IndexQuote | null {
  const price = positive(q.regularMarketPrice);
  if (!price) return null;
  return {
    symbol: item.symbol,
    name: item.name,
    price,
    changePct: q.regularMarketChangePercent ?? null,
    change: pointsChange(price, q.regularMarketChangePercent),
    open: positive(q.regularMarketOpen),
    dayHigh: positive(q.regularMarketDayHigh),
    dayLow: positive(q.regularMarketDayLow),
    yearHigh: positive(q.fiftyTwoWeekHigh),
    yearLow: positive(q.fiftyTwoWeekLow),
    yearChangePct: q.fiftyTwoWeekChangePercent ?? null,
    time: q.regularMarketTime ?? 0,
  };
}

/** The three indices and every sector, today: one request to Yahoo. */
export function getOverview(): Promise<OverviewResponse> {
  return cached("overview", PRICE_TTL_S * 1000, async () => {
    const quotes = await fetchQuotes([...new Set([...INDICES, ...SECTORS].map((i) => i.symbol))]);
    const pick = (items: IndexItem[]) => items.flatMap((i) => (quotes[i.symbol] ? (indexQuote(i, quotes[i.symbol]) ?? []) : []));
    const indices = pick(INDICES);
    if (!indices.length) throw new Error("No prices");
    const delay = Object.values(quotes).find((q) => q.exchangeDataDelayedBy != null)?.exchangeDataDelayedBy ?? null;
    return { indices, sectors: pick(SECTORS), delayMinutes: delay, fetchedAt: Date.now() };
  });
}

export function member(c: { symbol: string; name: string; industry: string }, q: QuoteFields | undefined): Member {
  return {
    symbol: c.symbol,
    // NSE's names are the short, familiar ones ("Ashok Leyland Ltd.").
    name: c.name,
    industry: c.industry,
    price: positive(q?.regularMarketPrice),
    changePct: q?.regularMarketChangePercent ?? null,
    marketCap: positive(q?.marketCap),
    pe: positive(q?.trailingPE),
    eps: q?.epsTrailingTwelveMonths ?? null,
    pb: positive(q?.priceToBook),
    dividendYield: q?.trailingAnnualDividendYield == null ? null : q.trailingAnnualDividendYield * 100,
    yearHigh: positive(q?.fiftyTwoWeekHigh),
    yearLow: positive(q?.fiftyTwoWeekLow),
    yearChangePct: q?.fiftyTwoWeekChangePercent ?? null,
  };
}

/** An index's companies (NSE's list) with today's figures from Yahoo. */
export function getMembers(symbol: string): Promise<MembersResponse> {
  const item = BY_SYMBOL[symbol];
  if (!item) return Promise.reject(new Error("Unknown index"));
  return cached(`members:${symbol}`, PRICE_TTL_S * 1000, async () => {
    const list = await cached(`list:${item.list}`, LIST_TTL_MS, () => fetchConstituents(item.list));
    const quotes = await fetchQuotes(list.map((c) => c.symbol));
    return { symbol, name: item.name, members: list.map((c) => member(c, quotes[c.symbol])), fetchedAt: Date.now() };
  });
}

export function getRatios(symbol: string): Promise<CompanyRatios> {
  return cached(`ratios:${symbol}`, RATIOS_TTL_S * 1000, () => fetchRatios(symbol));
}

/** Cache-Control for a shared answer kept `seconds`: the CDN serves it that long, then an older copy while it refreshes. */
export const cacheFor = (seconds: number) => `public, max-age=${Math.min(seconds, 600)}, s-maxage=${seconds}, stale-while-revalidate=${seconds * 4}`;
