/**
 * The stocks in a Nifty index, from NSE's own lists on niftyindices.com (free, a small CSV per index:
 * "Company Name,Industry,Symbol,Series,ISIN Code"). NSE reviews them twice a year, so they're kept a week.
 */
const BASE = "https://www.niftyindices.com/IndexConstituent";

export interface Constituent {
  name: string;
  industry: string;
  /** As Yahoo writes it: the NSE symbol and ".NS". */
  symbol: string;
}

/** One CSV line into cells, allowing "quoted, cells". */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parseConstituents(csv: string): Constituent[] {
  const [header, ...rows] = csv.replace(/^﻿/, "").trim().split(/\r?\n/);
  const cols = cells(header).map((c) => c.toLowerCase());
  const [name, industry, symbol] = ["company name", "industry", "symbol"].map((c) => cols.indexOf(c));
  if (name < 0 || symbol < 0) throw new Error("Unexpected constituents format");
  const seen = new Set<string>();
  const out: Constituent[] = [];
  for (const row of rows) {
    const c = cells(row);
    const sym = c[symbol];
    if (!sym || !/^[A-Z0-9&\-]+$/.test(sym) || seen.has(sym)) continue;
    seen.add(sym);
    out.push({ name: c[name] || sym, industry: industry >= 0 ? c[industry] || "" : "", symbol: `${sym}.NS` });
  }
  if (!out.length) throw new Error("No constituents");
  return out;
}

export async function fetchConstituents(list: string): Promise<Constituent[]> {
  if (!/^ind_[a-z0-9_]+$/.test(list)) throw new Error("Bad list name");
  const res = await fetch(`${BASE}/${list}.csv`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": "Mozilla/5.0 (compatible; MoneyManager/1.0)" },
  });
  if (!res.ok) throw new Error(`niftyindices answered ${res.status}`);
  return parseConstituents(await res.text());
}
