import { CATALOG, DERIVED, GLOBAL_SECTORS, INDIA, OVERVIEW, SECTORS, UNITS } from "./catalog";
import { fetchConstituents, type Constituent } from "./constituents";
import { fetchIbja, spliceHistory } from "./ibja";
import { fetchEconomies } from "./economy";
import { fetchFundHistory, fundChart, fundQuote, isFund, searchFunds } from "./funds";
import { dailySpark, memberIndex, performance, prevCloseFromDaily } from "./perf";
import type { ChartData, Economy, EconomyResponse, LtpResponse, MarketRange, PricePoint, Quote, QuotesResponse, SearchHit, SectorResponse, ValuationResponse } from "./types";
import { fetchFundamentals, fetchShares, fetchYahooChart, searchYahoo, type ParsedChart } from "./yahoo";
import { fetchNseIndices, groupPe } from "./valuation";

/**
 * The server side of the Market page. This is a page for seeing how markets and economies are doing,
 * not for trading, so everything is kept a good while: prices half an hour, economic figures half a
 * day. The sources are asked a few dozen times a day however many people open the page. When a source
 * fails, the last good answer is served instead, however old.
 */

interface Entry {
  /** When `value` stops being fresh. */
  until: number;
  value: Promise<unknown>;
  /** The last answer that worked, served when a refresh fails. */
  good?: unknown;
}
const store = new Map<string, Entry>();
/** After a failure, how long before the source is tried again. */
const RETRY_MS = 60_000;

/** `ttlMs` may depend on the answer: a partial one is kept only briefly. */
function cached<T>(key: string, ttlMs: number | ((value: T) => number), load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() < hit.until) return hit.value as Promise<T>;
  const ttl = (v?: T) => (typeof ttlMs === "number" ? ttlMs : v === undefined ? RETRY_MS : ttlMs(v));
  const entry: Entry = { until: Date.now() + ttl(), value: Promise.resolve(), good: hit?.good };
  entry.value = load().then(
    (v) => {
      entry.until = Date.now() + ttl(v);
      return (entry.good = v);
    },
    (err) => {
      if (entry.good === undefined) {
        store.delete(key);
        throw err;
      }
      entry.until = Date.now() + RETRY_MS;
      return entry.good;
    },
  );
  store.set(key, entry);
  if (store.size > 2000) store.delete(store.keys().next().value!);
  return entry.value as Promise<T>;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** How long prices are kept, in seconds: also what the routes tell the CDN. */
export const PRICE_TTL_S = 30 * 60;
export const ECONOMY_TTL_S = 12 * 60 * 60;
const TTL: Record<MarketRange, number> = { "1d": PRICE_TTL_S * 1000, "5d": HOUR, "1mo": 2 * HOUR, "6mo": 6 * HOUR, "1y": PRICE_TTL_S * 1000, "5y": 12 * HOUR };

const yahoo = (symbol: string, range: MarketRange) => cached(`y:${symbol}:${range}`, TTL[range], () => fetchYahooChart(symbol, range));
const fund = (symbol: string) => cached(`f:${symbol}`, 6 * HOUR, () => fetchFundHistory(symbol));

/** a × b at each of a's times, b taken as its latest value at or before then (its first before it starts). */
export function multiplySeries(a: PricePoint[], b: PricePoint[], factor: number): PricePoint[] {
  if (!b.length) return [];
  let j = 0;
  return a.map(({ t, v }) => {
    while (j + 1 < b.length && b[j + 1].t <= t) j++;
    return { t, v: v * b[j].v * factor };
  });
}

const dailyPrev = (c: ParsedChart) => prevCloseFromDaily(c.points, c.time, c.gmtoffset) ?? c.chartPrevClose;

function quote(base: ParsedChart, over: Partial<Quote> & { price: number; prevClose: number; history: PricePoint[] }): Quote {
  const { history, ...rest } = over;
  const item = CATALOG[rest.symbol ?? base.symbol];
  return {
    symbol: base.symbol,
    name: item?.name ?? base.name,
    kind: base.kind,
    currency: base.currency,
    unit: UNITS[base.symbol],
    change: over.price - over.prevClose,
    changePct: over.prevClose ? ((over.price - over.prevClose) / over.prevClose) * 100 : 0,
    perf: performance(history, over.price, over.prevClose),
    yearHigh: base.yearHigh,
    yearLow: base.yearLow,
    time: base.time,
    exchange: base.exchange,
    timezone: base.timezone,
    spark: dailySpark(history),
    ...rest,
  };
}

/** IBJA's rates: published around noon and 6 PM on working days, so they're asked for as often as prices. */
const ibja = () => cached("ibja", PRICE_TTL_S * 1000, fetchIbja);

/**
 * Gold or silver at India's rate: IBJA's daily rates, and before them (for a year's returns or a longer
 * chart) the world price in rupees, scaled to meet IBJA's first rate.
 */
async function bullion(symbol: string, range: "1y" | "5y") {
  const d = DERIVED[symbol];
  const [rates, base, fx] = await Promise.all([ibja(), yahoo(d.base, range), yahoo(d.fx, range)]);
  const own = rates[d.metal];
  return { d, base, own, history: spliceHistory(multiplySeries(base.points, fx.points, d.factor), own.history) };
}

const IST_DATE = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

async function derivedQuote(symbol: string): Promise<Quote> {
  const { d, base, own, history } = await bullion(symbol, "1y");
  const latest = own.history.at(-1)!;
  const year = history.filter((p) => p.t >= latest.t - 365 * 86_400).map((p) => p.v);
  return quote(base, {
    symbol,
    name: CATALOG[symbol]?.name ?? symbol,
    kind: "commodity",
    currency: "INR",
    unit: d.unit,
    exchange: "IBJA",
    timezone: "Asia/Kolkata",
    daily: true,
    note: `IBJA's rate for ${d.what}, ${own.session === "AM" ? "noon" : "6 PM"} rate of ${IST_DATE.format(latest.t * 1000)}. Includes import duty; jewellers add 3% GST and making charges. Before ${IST_DATE.format(own.history[0].t * 1000)}, returns and the chart follow the world price, scaled to IBJA's.`,
    price: latest.v,
    prevClose: own.history.at(-2)!.v,
    time: latest.t,
    yearHigh: Math.max(...year),
    yearLow: Math.min(...year),
    history,
  });
}

const members = (list: string) => cached(`list:${list}`, 7 * 24 * HOUR, () => fetchConstituents(list));

/**
 * An index's history rebuilt from its stocks, for one range: weighted by company size when Yahoo gives
 * share counts (kept a week), equally otherwise. Only stocks that answered count.
 */
async function membersIndex(list: string, range: MarketRange): Promise<{ points: PricePoint[]; count: number; weighted: boolean }> {
  const stocks = await members(list);
  // 1M and 6M are cut from the year of dailies the overview already fetched; 5Y needs its own (weekly) prices.
  const source: MarketRange = range === "5y" ? "5y" : "1y";
  const [charts, shares] = await Promise.all([
    mapLimited(stocks, 6, (m) => yahoo(m.symbol, source)),
    cached(`shares:${list}`, 7 * 24 * HOUR, () => fetchShares(stocks.map((m) => m.symbol))).catch(() => ({}) as Record<string, number>),
  ]);
  const series: PricePoint[][] = [];
  const counts: (number | null)[] = [];
  charts.forEach((r, i) => {
    if (r.status !== "fulfilled" || !r.value.points.length) return;
    series.push(r.value.points);
    counts.push(shares[stocks[i].symbol] ?? null);
  });
  if (!series.length) throw new Error("No member prices");
  // Weighted only if most members have a share count; otherwise the missing ones would skew it.
  const weighted = counts.filter((c) => c !== null).length >= series.length * 0.8;
  let points = memberIndex(series, weighted ? counts : undefined);
  if (range !== source) {
    const days = range === "1mo" ? 31 : range === "6mo" ? 183 : 7;
    const from = (points.at(-1)?.t ?? 0) - days * 86_400;
    points = points.filter((p) => p.t >= from);
  }
  return { points, count: series.length, weighted };
}

/** A year of daily closes gives the price, the day's change, the returns and the trend line in one request. */
async function yahooQuote(symbol: string): Promise<Quote> {
  const daily = await yahoo(symbol, "1y");
  const item = CATALOG[symbol];
  const proxy = item?.history;
  if (daily.points.length >= 20 && !proxy) return quote(daily, { price: daily.price, prevClose: dailyPrev(daily) ?? daily.price, history: daily.points });

  // No history for this index on Yahoo: today's move from its intraday chart, the rest from the ETF that
  // tracks it, or from its own stocks when there's no such ETF.
  const today = await yahoo(symbol, "1d");
  const base = { price: today.price, prevClose: today.chartPrevClose ?? today.price };
  if (proxy === "members" && item.constituents) {
    const built = await membersIndex(item.constituents, "1y").catch(() => null);
    return quote(daily, {
      ...base,
      history: built?.points ?? [],
      note: built
        ? built.weighted
          ? `Returns beyond today are rebuilt from the index's ${built.count} stocks, weighted by company size (close to NSE's figure, not exact)`
          : `Returns beyond today average the index's ${built.count} stocks equally (NSE weights bigger companies more, so it can differ)`
        : undefined,
    });
  }
  const tracker = proxy ? await yahoo(proxy, "1y") : null;
  return quote(daily, {
    ...base,
    history: tracker?.points ?? [],
    note: tracker ? `Returns beyond today follow ${tracker.name}, which tracks this index` : undefined,
  });
}

export async function getQuote(symbol: string): Promise<Quote> {
  if (isFund(symbol)) return fundQuote(symbol, await fund(symbol));
  if (DERIVED[symbol]) return derivedQuote(symbol);
  return yahooQuote(symbol);
}

export async function getChart(symbol: string, range: MarketRange): Promise<ChartData> {
  if (isFund(symbol)) return fundChart(symbol, range, await fund(symbol));
  if (DERIVED[symbol]) {
    const { history } = await bullion(symbol, range === "5y" ? "5y" : "1y");
    const days = { "1d": 7, "5d": 7, "1mo": 31, "6mo": 183, "1y": 366, "5y": 5 * 366 }[range];
    const from = (history.at(-1)?.t ?? 0) - days * 86_400;
    return { symbol, range, timezone: "Asia/Kolkata", points: history.filter((p) => p.t >= from), prevClose: null };
  }
  const item = CATALOG[symbol];
  const proxy = item?.history;
  if (proxy === "members" && item.constituents && range !== "1d") {
    // The stocks' equal-weighted line, scaled so it ends at the index's level.
    const [today, built] = await Promise.all([yahoo(symbol, "1d"), membersIndex(item.constituents, range)]);
    const last = built.points.at(-1)?.v;
    const k = last ? today.price / last : 1;
    return { symbol, range, timezone: "Asia/Kolkata", points: built.points.map((p) => ({ t: p.t, v: p.v * k })), prevClose: null };
  }
  if (proxy && range !== "1d") {
    // The ETF's line, scaled so it ends at the index's level: the shape is the ETF's, the numbers read as the index.
    const [today, tracker] = await Promise.all([yahoo(symbol, "1d"), yahoo(proxy, range)]);
    const last = tracker.points.at(-1)?.v;
    const k = last ? today.price / last : 1;
    return { symbol, range, timezone: tracker.timezone, points: tracker.points.map((p) => ({ t: p.t, v: p.v * k })), prevClose: null };
  }
  const c = await yahoo(symbol, range);
  return { symbol, range, timezone: c.timezone, points: c.points, prevClose: range === "1d" ? c.chartPrevClose : null };
}

/** Runs `fn` over the items, a few at a time, so a long list doesn't fire dozens of requests at once. */
export async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
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

export async function getQuotes(symbols: string[]): Promise<QuotesResponse> {
  const results = await mapLimited(symbols, 6, getQuote);
  const body: QuotesResponse = { quotes: [], failed: [], fetchedAt: Date.now() };
  results.forEach((r, i) => (r.status === "fulfilled" ? body.quotes.push(r.value) : body.failed.push(symbols[i])));
  return body;
}

/** Last traded prices for open stock positions: kept only seconds, since a scalper's P&L moves tick by tick. */
export const LTP_TTL_S = 15;
export async function getLtp(symbols: string[]): Promise<LtpResponse> {
  const results = await mapLimited(symbols, 6, (s) => cached(`ltp:${s}`, LTP_TTL_S * 1000, () => fetchYahooChart(s, "1d")));
  const body: LtpResponse = { prices: {}, fetchedAt: Date.now() };
  results.forEach((r, i) => {
    if (r.status === "fulfilled") body.prices[symbols[i]] = { price: r.value.price, prevClose: r.value.chartPrevClose, time: r.value.time };
  });
  return body;
}

/** Everything on the page, as one answer: the same for every visitor, so one copy serves all. */
export function getOverview(): Promise<QuotesResponse> {
  return cached("overview", PRICE_TTL_S * 1000, async () => {
    const body = await getQuotes(OVERVIEW.map((c) => c.symbol));
    if (!body.quotes.length) throw new Error("No prices");
    return body;
  });
}

/**
 * A sector's stocks, each with its price, returns and trend: NSE's list of the index (kept a week),
 * then the same yearly prices as everything else. Fetched only when someone opens the sector.
 */
export function getSector(symbol: string): Promise<SectorResponse> {
  const item = CATALOG[symbol];
  if (!item?.constituents) return Promise.reject(new Error("Not a sector"));
  const list = item.constituents;
  return cached(`sector:${symbol}`, PRICE_TTL_S * 1000, async () => {
    const stocks = await members(list);
    const results = await mapLimited(stocks, 6, (m) => getQuote(m.symbol));
    const body: SectorResponse = { symbol, name: item.name, stocks: [], failed: [], fetchedAt: Date.now() };
    results.forEach((r, i) => {
      const m = stocks[i];
      // NSE's names are the short, familiar ones ("Ashok Leyland Ltd.").
      if (r.status === "fulfilled") body.stocks.push({ ...r.value, name: m.name, industry: m.industry });
      else body.failed.push(m.name);
    });
    if (!body.stocks.length) throw new Error("No prices for this sector");
    return body;
  });
}

/**
 * PEs for the page: NSE's own for every Nifty index; for each sector, the same worked out from its
 * stocks and the closest world sector's; for each stock, its own and its industry's (across the Nifty
 * 500). Prices move PEs, so they're kept as long as prices. A partial answer is kept only minutes.
 */
export function getValuation(): Promise<ValuationResponse> {
  return cached(
    "valuation",
    (v) => (v.complete ? PRICE_TTL_S * 1000 : 5 * MINUTE),
    async () => {
      const sectors = SECTORS.filter((s) => s.constituents);
      const [nse, broad, ...lists] = await Promise.allSettled([fetchNseIndices(), members("ind_nifty500list"), ...sectors.map((s) => members(s.constituents!))]);
      const sectorStocks = lists.map((r) => (r.status === "fulfilled" ? r.value : null));
      const universe: Constituent[] = [...(broad.status === "fulfilled" ? broad.value : []), ...sectorStocks.flatMap((l) => l ?? [])];
      const industryOf = new Map(universe.map((c) => [c.symbol, c.industry]));
      const symbols = [...new Set([...industryOf.keys(), ...GLOBAL_SECTORS.map((g) => g.symbol)])];
      const fundamentals = await fetchFundamentals(symbols).catch(() => ({}) as Awaited<ReturnType<typeof fetchFundamentals>>);
      const anyFundamentals = Object.keys(fundamentals).length > 0;

      const body: ValuationResponse = { indices: {}, industries: {}, stocks: {}, nseAsOf: nse.status === "fulfilled" ? nse.value.asOf : null, fetchedAt: Date.now(), complete: false };
      for (const item of [...INDIA, ...SECTORS]) {
        const official = item.nse && nse.status === "fulfilled" ? nse.value.indices[item.nse] : undefined;
        const i = sectors.indexOf(item);
        const own = i >= 0 ? sectorStocks[i] : null;
        const peer = item.global ? CATALOG[item.global] : undefined;
        body.indices[item.symbol] = {
          pe: official?.pe ?? null,
          pb: official?.pb ?? null,
          dy: official?.dy ?? null,
          fromStocks: own && anyFundamentals ? groupPe(own.map((c) => fundamentals[c.symbol])) : null,
          global: peer ? { symbol: peer.symbol, name: peer.name, pe: fundamentals[peer.symbol]?.pe ?? null } : null,
        };
      }
      if (broad.status === "fulfilled" && anyFundamentals) {
        const byIndustry = new Map<string, Constituent[]>();
        for (const c of broad.value) if (c.industry) byIndustry.set(c.industry, [...(byIndustry.get(c.industry) ?? []), c]);
        for (const [industry, list] of byIndustry) body.industries[industry] = groupPe(list.map((c) => fundamentals[c.symbol]));
      }
      for (const [symbol, industry] of industryOf) {
        const f = fundamentals[symbol];
        if (f) body.stocks[symbol] = { pe: f.pe, loss: f.eps !== null && f.eps < 0, industry };
      }
      body.complete = nse.status === "fulfilled" && broad.status === "fulfilled" && sectorStocks.every(Boolean) && anyFundamentals;
      if (nse.status === "rejected" && !anyFundamentals) throw new Error("No valuations");
      return body;
    },
  );
}

/** Whether every economy has its main figures; if a source was down, the answer is kept only a few minutes. */
export const isComplete = (economies: Economy[]) => economies.every((e) => e.gdpGrowth.length > 0 && (e.code === "WEOWORLD" || e.policy));

export function getEconomy(): Promise<EconomyResponse> {
  return cached(
    "economy",
    (v) => (v.complete ? ECONOMY_TTL_S * 1000 : 10 * MINUTE),
    async () => {
      const { economies, fromWorldBank } = await fetchEconomies();
      return { economies, fetchedAt: Date.now(), complete: isComplete(economies), fromWorldBank };
    },
  );
}

/** Shares, indices, ETFs, crypto… and Indian mutual funds, in one list. Either source may be down. */
export async function search(q: string): Promise<SearchHit[]> {
  const key = q.trim().toLowerCase();
  return cached(`s:${key}`, 24 * HOUR, async () => {
    const [stocks, funds] = await Promise.allSettled([searchYahoo(key), searchFunds(key)]);
    if (stocks.status === "rejected" && funds.status === "rejected") throw stocks.reason;
    return [...(stocks.status === "fulfilled" ? stocks.value : []), ...(funds.status === "fulfilled" ? funds.value : [])];
  });
}

/** Symbols as Yahoo and the app write them: letters, digits and ^ = . - _ & and the MF: prefix. */
export const SYMBOL_RE = /^[A-Za-z0-9^=.\-_&:]{1,32}$/;

/** Cache-Control for a shared answer kept `seconds`: the CDN serves it that long, then an older copy while it refreshes. */
export const cacheFor = (seconds: number) => `public, max-age=${Math.min(seconds, 600)}, s-maxage=${seconds}, stale-while-revalidate=${seconds * 4}`;
