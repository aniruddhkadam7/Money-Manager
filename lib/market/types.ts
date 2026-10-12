/**
 * Markets and the economy, as the /api/market routes hand them to the page. Prices are plain numbers in
 * the instrument's own currency (index points for an index): they're figures to look at, not money in
 * the book, so they don't use the book's integer paise. Percentages are plain percent (6.5 = 6.5%).
 */

export type MarketKind = "index" | "equity" | "etf" | "fund" | "commodity" | "currency" | "crypto" | "yield";

/** How far back the big chart goes. Funds have one price a day, so only the longer ranges suit them. */
export type MarketRange = "1d" | "5d" | "1mo" | "6mo" | "1y" | "5y";

export const RANGES: { value: MarketRange; label: string }[] = [
  { value: "1d", label: "1D" },
  { value: "1mo", label: "1M" },
  { value: "6mo", label: "6M" },
  { value: "1y", label: "1Y" },
  { value: "5y", label: "5Y" },
];
export const FUND_RANGES = RANGES.filter((r) => r.value !== "1d");

/** The return the page shows beside everything, over one chosen period. */
export type Period = "1d" | "1w" | "1m" | "3m" | "1y";
export const PERIODS: { value: Period; label: string; words: string }[] = [
  { value: "1d", label: "1D", words: "today" },
  { value: "1w", label: "1W", words: "this week" },
  { value: "1m", label: "1M", words: "this month" },
  { value: "3m", label: "3M", words: "in 3 months" },
  { value: "1y", label: "1Y", words: "this year" },
];
export type Performance = Record<Period, number | null>;

export interface PricePoint {
  /** Seconds since 1970 (UTC). */
  t: number;
  v: number;
}

export interface Quote {
  symbol: string;
  name: string;
  kind: MarketKind;
  /** ISO code, e.g. INR or USD. */
  currency: string | null;
  /** What the price is per, for prices that aren't per share or point: "10 g", "kg", "barrel". */
  unit?: string;
  price: number;
  /** The last session's close, which the day's change is measured from. */
  prevClose: number;
  change: number;
  changePct: number;
  /** Percent change over each period; null where there isn't that much history. */
  perf: Performance;
  yearHigh: number | null;
  yearLow: number | null;
  /** When the price was last updated, in seconds. */
  time: number;
  exchange: string | null;
  /** IANA zone the exchange keeps time in; times on its chart are shown in it. */
  timezone: string;
  /** Up to a year of daily closes, latest last, for the small trend line (cut to the period shown). */
  spark: number[];
  /** A word on how the price or its history is worked out, when it isn't simply quoted. */
  note?: string;
}

export interface ChartData {
  symbol: string;
  range: MarketRange;
  timezone: string;
  points: PricePoint[];
  /** For the one-day chart: the line the day's change is measured from. */
  prevClose: number | null;
}

export interface SearchHit {
  symbol: string;
  name: string;
  exchange: string | null;
  kind: MarketKind;
}

export interface QuotesResponse {
  quotes: Quote[];
  /** Symbols that couldn't be fetched this time. */
  failed: string[];
  /** When the server fetched these, in ms. */
  fetchedAt: number;
}

/** One figure for a run of years; years from the current one on are IMF estimates and forecasts. */
export interface YearValue {
  year: number;
  value: number;
  forecast: boolean;
}

export interface PolicyRate {
  bank: string;
  rate: number;
  /** "2026-09": the month the rate is as of. */
  asOf: string;
  /** The latest move: month and size in percentage points (−0.25 is a cut). */
  lastChange: { month: string; by: number } | null;
  /** Month-end rates for about five years, oldest first. */
  history: number[];
}

export interface EconomyIndicators {
  /** Real GDP growth, %. */
  gdpGrowth: YearValue[];
  /** Consumer price inflation, %. */
  inflation: YearValue[];
  /** Unemployment rate, %. */
  unemployment: YearValue[];
  /** Government debt, % of GDP. */
  debt: YearValue[];
  /** Current account balance, % of GDP (negative: more going out than coming in). */
  currentAccount: YearValue[];
  /** Government budget balance, % of GDP (negative: a deficit). */
  fiscalBalance: YearValue[];
  /** GDP per person, US dollars. */
  gdpPerCapita: YearValue[];
  /** GDP, billions of US dollars. */
  gdpSize: YearValue[];
}

/** How an economy is judged: a fast-growing emerging one and a mature advanced one have different healthy ranges. */
export type EconomyGroup = "world" | "emerging" | "advanced";

export interface Economy extends EconomyIndicators {
  code: string;
  name: string;
  group: EconomyGroup;
  policy: PolicyRate | null;
  /** Foreign-exchange reserves, in months of imports they'd pay for (World Bank). */
  reserves: { year: number; months: number } | null;
  /** Where its GDP ranks among the world's countries in the last full year (1 = largest). */
  sizeRank: number | null;
}

export interface EconomyResponse {
  economies: Economy[];
  fetchedAt: number;
  /** False when a source was down and some figures are missing: worth asking again soon. */
  complete: boolean;
}

export interface SectorStock extends Quote {
  /** NSE's industry for the company, e.g. "Capital Goods". */
  industry: string;
}

export interface SectorResponse {
  symbol: string;
  name: string;
  stocks: SectorStock[];
  /** Stocks whose prices couldn't be fetched this time. */
  failed: string[];
  fetchedAt: number;
}
