import type { SearchHit } from "./types";

export interface IndianShare {
  /** The trading symbol, e.g. RELIANCE: what's saved as the holding's name. */
  symbol: string;
  name: string;
  exchange: string;
}

/** NSE and BSE shares only, one row per company (its NSE listing when it has one), as Zerodha lists them. */
export function indianShares(hits: SearchHit[]): IndianShare[] {
  const out = new Map<string, IndianShare>();
  for (const h of hits) {
    const m = /^(.+)\.(NS|BO)$/.exec(h.symbol);
    if (!m || (h.kind !== "equity" && h.kind !== "etf")) continue;
    const exchange = m[2] === "NS" ? "NSE" : "BSE";
    const seen = out.get(h.name.toLowerCase());
    if (!seen || (seen.exchange === "BSE" && exchange === "NSE")) out.set(h.name.toLowerCase(), { symbol: m[1], name: h.name, exchange });
  }
  return [...out.values()];
}
