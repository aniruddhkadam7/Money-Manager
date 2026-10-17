/**
 * The Market page's data, as the /api/market routes hand it over. Prices in rupees (index points for an
 * index), percentages as plain percent (6.5 = 6.5%). A figure Yahoo doesn't give is null, never a stand-in.
 */

/** An index (or sector index) today. */
export interface IndexQuote {
  symbol: string;
  name: string;
  price: number;
  /** Today's change, %. */
  changePct: number | null;
  /** Today's change, points. */
  change: number | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  /** Change over 52 weeks, %. */
  yearChangePct: number | null;
  /** When the price was last updated, seconds. */
  time: number;
}

export interface OverviewResponse {
  indices: IndexQuote[];
  sectors: IndexQuote[];
  /** How far behind NSE Yahoo says its prices are, minutes. */
  delayMinutes: number | null;
  fetchedAt: number;
}

/** One company in an index, with the figures the comparison table needs. */
export interface Member {
  symbol: string;
  name: string;
  /** NSE's industry for the company, e.g. "Information Technology". */
  industry: string;
  price: number | null;
  changePct: number | null;
  /** Rupees. */
  marketCap: number | null;
  /** Price ÷ the last four quarters' earnings per share; Yahoo leaves it out for loss-makers. */
  pe: number | null;
  /** The last four quarters' earnings per share; negative for a loss. */
  eps: number | null;
  pb: number | null;
  /** Last 12 months' dividends ÷ price, %. */
  dividendYield: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  /** Change over 52 weeks, %. */
  yearChangePct: number | null;
}

export interface MembersResponse {
  symbol: string;
  name: string;
  members: Member[];
  fetchedAt: number;
}

/** A company's key ratios, from Yahoo. Fractions are given as percent (45.6 = 45.6%). */
export interface CompanyRatios {
  symbol: string;
  roe: number | null;
  roa: number | null;
  operatingMargin: number | null;
  profitMargin: number | null;
  /** Latest quarter against the same quarter a year before, %. */
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  /** Debt ÷ equity, times. */
  debtToEquity: number | null;
  currentRatio: number | null;
  evToEbitda: number | null;
  bookValue: number | null;
  beta: number | null;
  fetchedAt: number;
}

export type HistoryRange = "1M" | "6M" | "1Y" | "5Y";

/** Every sector's closing level on shared dates (a day a sector has no close carries its last one forward). */
export interface SectorHistoryResponse {
  range: HistoryRange;
  /** YYYY-MM-DD, oldest first. */
  dates: string[];
  /** `rebuilt`: Yahoo has no history for the index itself, so its level is rebuilt from its largest companies. */
  sectors: { symbol: string; name: string; rebuilt: boolean; closes: number[] }[];
  fetchedAt: number;
}
