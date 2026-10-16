import { z } from "zod";
import type { CompanyRatios } from "./types";

/**
 * Yahoo Finance's quote and quoteSummary endpoints: no key, but they want a session (a cookie from
 * fc.yahoo.com and a "crumb" that goes with it), which only a server can hold. Unofficial, so everything
 * is parsed defensively. Indian prices are about 15 minutes behind NSE.
 */
const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; MoneyManager/1.0)", accept: "application/json" };

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

/** Calls an endpoint that wants the session, starting a new session if Yahoo turned the old one away. */
async function withSession(url: (crumb: string) => string): Promise<unknown> {
  const { cookie, crumb } = await yahooSession();
  const res = await fetch(url(encodeURIComponent(crumb)), { headers: { ...HEADERS, cookie }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) session = null;
    throw new Error(`Yahoo answered ${res.status}`);
  }
  return res.json();
}

const Num = z.number().finite();
const QuoteJson = z.object({
  symbol: z.string(),
  regularMarketPrice: Num.nullish(),
  regularMarketChangePercent: Num.nullish(),
  regularMarketOpen: Num.nullish(),
  regularMarketDayHigh: Num.nullish(),
  regularMarketDayLow: Num.nullish(),
  regularMarketTime: Num.nullish(),
  fiftyTwoWeekHigh: Num.nullish(),
  fiftyTwoWeekLow: Num.nullish(),
  fiftyTwoWeekChangePercent: Num.nullish(),
  marketCap: Num.nullish(),
  trailingPE: Num.nullish(),
  epsTrailingTwelveMonths: Num.nullish(),
  priceToBook: Num.nullish(),
  trailingAnnualDividendYield: Num.nullish(),
  exchangeDataDelayedBy: Num.nullish(),
});
const QuotesJson = z.object({ quoteResponse: z.object({ result: z.array(QuoteJson).nullish() }) });

/** A quote as Yahoo's quote endpoint gives it; every field but the symbol may be missing. */
export type QuoteFields = z.infer<typeof QuoteJson>;
const FIELDS = Object.keys(QuoteJson.shape)
  .filter((k) => k !== "symbol")
  .join(",");

export function parseQuotes(json: unknown): QuoteFields[] {
  return QuotesJson.parse(json).quoteResponse.result ?? [];
}

/** Quotes for many symbols, 50 a request. Symbols Yahoo doesn't know are left out. */
export async function fetchQuotes(symbols: string[]): Promise<Record<string, QuoteFields>> {
  const out: Record<string, QuoteFields> = {};
  for (let i = 0; i < symbols.length; i += 50) {
    const batch = symbols.slice(i, i + 50).map(encodeURIComponent).join(",");
    for (const q of parseQuotes(await withSession((crumb) => `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${batch}&fields=${FIELDS}&crumb=${crumb}`))) out[q.symbol] = q;
  }
  return out;
}

/** quoteSummary wraps figures as { raw, fmt }. */
const Raw = z.object({ raw: Num.nullish() }).nullish();
const Module = z.record(z.string(), z.unknown()).nullish();
const SummaryJson = z.object({
  quoteSummary: z.object({
    result: z.array(z.object({ financialData: Module, defaultKeyStatistics: Module, summaryDetail: Module })).nullish(),
  }),
});

export function parseRatios(symbol: string, json: unknown): CompanyRatios {
  const r = SummaryJson.parse(json).quoteSummary.result?.[0];
  if (!r) throw new Error("No figures for that company");
  const raw = (obj: Record<string, unknown> | null | undefined, key: string) => Raw.safeParse(obj?.[key]).data?.raw ?? null;
  const pct = (obj: Record<string, unknown> | null | undefined, key: string) => {
    const v = raw(obj, key);
    return v === null ? null : v * 100;
  };
  const fd = r.financialData;
  const dte = raw(fd, "debtToEquity");
  return {
    symbol,
    roe: pct(fd, "returnOnEquity"),
    roa: pct(fd, "returnOnAssets"),
    operatingMargin: pct(fd, "operatingMargins"),
    profitMargin: pct(fd, "profitMargins"),
    revenueGrowth: pct(fd, "revenueGrowth"),
    earningsGrowth: pct(fd, "earningsGrowth"),
    // Yahoo writes debt ÷ equity as a percentage (9.83 for 0.098×).
    debtToEquity: dte === null ? null : dte / 100,
    currentRatio: raw(fd, "currentRatio"),
    evToEbitda: raw(r.defaultKeyStatistics, "enterpriseToEbitda"),
    bookValue: raw(r.defaultKeyStatistics, "bookValue"),
    beta: raw(r.summaryDetail, "beta"),
    fetchedAt: Date.now(),
  };
}

export async function fetchRatios(symbol: string): Promise<CompanyRatios> {
  const s = encodeURIComponent(symbol);
  return parseRatios(symbol, await withSession((crumb) => `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${s}?modules=financialData,defaultKeyStatistics,summaryDetail&crumb=${crumb}`));
}
