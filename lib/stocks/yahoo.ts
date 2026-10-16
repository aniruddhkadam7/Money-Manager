import { z } from "zod";

/**
 * Yahoo Finance's public chart and search endpoints, for the Investments page: finding an NSE or BSE
 * share by name, and its last traded price. No key; they're unofficial, so everything is parsed
 * defensively, and Indian prices are about 15 minutes behind the exchange.
 */
const BASE = "https://query1.finance.yahoo.com";
const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; MoneyManager/1.0)", accept: "application/json" };

export type StockKind = "index" | "equity" | "etf" | "fund" | "commodity" | "currency" | "crypto";

export interface SearchHit {
  symbol: string;
  name: string;
  exchange: string | null;
  kind: StockKind;
}

/** Last traded prices by Yahoo symbol (RELIANCE.NS). */
export interface LtpResponse {
  prices: Record<string, { price: number; prevClose: number | null; time: number }>;
  fetchedAt: number;
}

const KINDS: Record<string, StockKind> = {
  INDEX: "index",
  EQUITY: "equity",
  ETF: "etf",
  MUTUALFUND: "fund",
  FUTURE: "commodity",
  CURRENCY: "currency",
  CRYPTOCURRENCY: "crypto",
};

const Num = z.number().finite();
const ChartJson = z.object({
  chart: z.object({
    result: z
      .array(z.object({ meta: z.object({ regularMarketPrice: Num, chartPreviousClose: Num.nullish(), regularMarketTime: Num.nullish() }) }))
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

/** Search results of a kind Yahoo prices, Indian listings first. */
export function parseSearch(json: unknown): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const q of SearchJson.parse(json).quotes ?? []) {
    const kind = KINDS[q.quoteType ?? ""];
    if (!q.symbol || !kind) continue;
    // The long name is in normal case ("Reliance Industries Limited"); the short one is often in capitals.
    hits.push({ symbol: q.symbol, name: q.longname || q.shortname || q.symbol, exchange: q.exchDisp ?? null, kind });
  }
  const indian = (h: SearchHit) => (/\.(NS|BO)$/.test(h.symbol) || h.symbol.startsWith("^") ? 0 : 1);
  return hits.map((h, i) => ({ h, i })).sort((a, b) => indian(a.h) - indian(b.h) || a.i - b.i).map(({ h }) => h);
}

/** A share's last price, the close before today and when it traded, from its one-day chart. */
export function parseLastPrice(json: unknown): { price: number; prevClose: number | null; time: number } {
  const m = ChartJson.parse(json).chart.result?.[0]?.meta;
  if (!m) throw new Error("No data for that symbol");
  return { price: m.regularMarketPrice, prevClose: m.chartPreviousClose ?? null, time: m.regularMarketTime ?? 0 };
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Yahoo answered ${res.status}`);
  return res.json();
}

export async function fetchLastPrice(symbol: string) {
  return parseLastPrice(await getJson(`${BASE}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`));
}

export async function searchYahoo(q: string): Promise<SearchHit[]> {
  return parseSearch(await getJson(`${BASE}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0`));
}
