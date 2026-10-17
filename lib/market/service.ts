import { BY_SYMBOL, INDICES, SECTORS, type IndexItem } from "./catalog";
import { fetchConstituents } from "./constituents";
import type { CompanyRatios, HistoryRange, IndexQuote, Member, MembersResponse, OverviewResponse, SectorHistoryResponse } from "./types";
import { fetchCloses, fetchQuotes, fetchRatios, type Close, type QuoteFields } from "./yahoo";

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

/** Yahoo's range and bar size for each span the sector chart offers: daily bars, weekly over five years. */
export const HISTORY_RANGES: Record<HistoryRange, { range: string; interval: string }> = {
  "1M": { range: "1mo", interval: "1d" },
  "6M": { range: "6mo", interval: "1d" },
  "1Y": { range: "1y", interval: "1d" },
  "5Y": { range: "5y", interval: "1wk" },
};
/** Past closes don't change: ten minutes, so today's end still moves along. */
export const HISTORY_TTL_S = 600;

/** Lines series up on one set of dates: every date any has, from the first all of them have. A series with no closes is left out. */
export function alignCloses<T extends { closes: Close[] }>(items: T[]): { dates: string[]; items: (Omit<T, "closes"> & { closes: number[] })[] } {
  const withData = items.filter((i) => i.closes.length > 0);
  if (!withData.length) return { dates: [], items: [] };
  const start = withData.reduce((m, i) => (i.closes[0].date > m ? i.closes[0].date : m), "");
  const dates = [...new Set(withData.flatMap((i) => i.closes.map((c) => c.date)))].filter((d) => d >= start).sort();
  return {
    dates,
    items: withData.map(({ closes, ...rest }) => {
      let k = 0;
      let last = closes[0].close;
      return {
        ...rest,
        closes: dates.map((d) => {
          while (k < closes.length && closes[k].date <= d) last = closes[k++].close;
          return last;
        }),
      };
    }),
  };
}

/**
 * A sector's level rebuilt from its biggest companies, for the many sector indices Yahoo keeps no history for:
 * today's share count of each (market cap ÷ price) held fixed and valued at each day's close, the way a
 * market-cap index is built. Companies listed after the span began are left out rather than shortening it.
 */
export function basketCloses(members: { shares: number; closes: Close[] }[]): Close[] {
  const listed = members.filter((m) => m.closes.length > 0);
  if (!listed.length) return [];
  const firsts = listed.map((m) => m.closes[0].date).sort();
  const typical = firsts[Math.floor(firsts.length / 2)];
  const { dates, items } = alignCloses(listed.filter((m) => m.closes[0].date <= typical));
  return dates.map((date, i) => ({ date, close: items.reduce((t, m) => t + m.shares * m.closes[i], 0) }));
}

/** Runs `fn` over `items`, at most `limit` at a time, so a few hundred requests don't all go at once. */
async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Companies per sector used when rebuilding it: the largest carry nearly all of a cap-weighted index. */
const BASKET_SIZE = 15;

/**
 * Every sector's closes over a span, for comparing how they've moved. Yahoo's own index history where it has
 * the whole span; otherwise rebuilt from the sector's companies (flagged `rebuilt`). A sector neither works for is left out.
 */
export function getSectorHistory(range: HistoryRange): Promise<SectorHistoryResponse> {
  const { range: r, interval } = HISTORY_RANGES[range];
  const closesOf = (symbol: string) => cached(`closes:${symbol}:${range}`, HISTORY_TTL_S * 1000, () => fetchCloses(symbol, r, interval));
  return cached(`sector-history:${range}`, HISTORY_TTL_S * 1000, async () => {
    const items = [...new Map(SECTORS.map((s) => [s.symbol, s])).values()];
    const own = await pooled(items, 8, (s) => closesOf(s.symbol));
    const ownCloses = own.map((o) => (o.status === "fulfilled" ? o.value : []));
    // A full span is as many bars as the best-covered index has; much less means Yahoo only has the last day or two.
    const full = Math.max(...ownCloses.map((c) => c.length));
    const short = items.filter((_, i) => ownCloses[i].length < full * 0.8);

    const members = await pooled(short, 4, (s) => getMembers(s.symbol));
    const baskets = short.map((s, i) => {
      const m = members[i];
      if (m.status !== "fulfilled") return { symbol: s.symbol, members: [] };
      const top = m.value.members
        .filter((c) => c.marketCap && c.price)
        .sort((a, b) => b.marketCap! - a.marketCap!)
        .slice(0, BASKET_SIZE);
      return { symbol: s.symbol, members: top.map((c) => ({ symbol: c.symbol, shares: c.marketCap! / c.price! })) };
    });
    const stocks = [...new Set(baskets.flatMap((b) => b.members.map((m) => m.symbol)))];
    const stockCloses = await pooled(stocks, 8, closesOf);
    const closesBySymbol = new Map(stocks.map((sym, i) => [sym, stockCloses[i].status === "fulfilled" ? stockCloses[i].value : []]));
    const rebuilt = new Map(baskets.map((b) => [b.symbol, basketCloses(b.members.map((m) => ({ shares: m.shares, closes: closesBySymbol.get(m.symbol) ?? [] })))]));

    const { dates, items: sectors } = alignCloses(
      items
        .map((s, i) => (rebuilt.has(s.symbol) ? { symbol: s.symbol, name: s.name, rebuilt: true, closes: rebuilt.get(s.symbol)! } : { symbol: s.symbol, name: s.name, rebuilt: false, closes: ownCloses[i] }))
        // A rebuilt sector that also came up short is left out, so it can't cut everyone's span down.
        .filter((s) => s.closes.length >= full * 0.8),
    );
    if (dates.length < 2) throw new Error("No history");
    return { range, dates, sectors, fetchedAt: Date.now() };
  });
}

/** Cache-Control for a shared answer kept `seconds`: the CDN serves it that long, then an older copy while it refreshes. */
export const cacheFor = (seconds: number) => `public, max-age=${Math.min(seconds, 600)}, s-maxage=${seconds}, stale-while-revalidate=${seconds * 4}`;
