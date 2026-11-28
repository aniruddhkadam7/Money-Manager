/**
 * Share prices from Kotak Neo (read only, server side): live last price and daily closes, for NSE shares. These
 * calls need only the Trade API token (KOTAK_NEO_TOKEN), no login. Kotak knows a share by its instrument number,
 * looked up by trading symbol in its scrip master (a file it publishes daily), kept here for half a day.
 */

const HOST = "https://mis.kotaksecurities.com";
const HALF_DAY = 12 * 3600_000;

type Fetch = typeof fetch;
const headersOf = (token: string) => ({ authorization: token, "content-type": "application/x-www-form-urlencoded", accept: "application/json" });

let tokens: { at: number; bySymbol: Map<string, string> } | null = null;
let loading: Promise<Map<string, string>> | null = null;

/** The NSE cash-market scrip master as symbol → instrument number ("ADANIPOWER" → "17388"); equity series first. */
export function parseScripMaster(csv: string): Map<string, string> {
  const lines = csv.split(/\r?\n/);
  const head = lines[0].split(",").map((h) => h.trim());
  const col = (name: string) => head.indexOf(name);
  const [iTok, iGroup, iName, iTrd] = [col("pSymbol"), col("pGroup"), col("pSymbolName"), col("pTrdSymbol")];
  const out = new Map<string, string>();
  const rank = new Map<string, number>();
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const c = line.split(",");
    const name = c[iName]?.trim().toUpperCase();
    const tok = c[iTok]?.trim();
    if (!name || !tok) continue;
    // EQ (regular) beats BE/BZ (trade-to-trade) for the same company.
    const r = c[iGroup]?.trim() === "EQ" ? 0 : 1;
    if (!out.has(name) || r < (rank.get(name) ?? 9)) {
      out.set(name, tok);
      rank.set(name, r);
    }
    const trd = c[iTrd]?.trim().toUpperCase();
    if (trd && !out.has(trd)) out.set(trd, tok);
  }
  return out;
}

async function scripMaster(token: string, f: Fetch): Promise<Map<string, string>> {
  if (tokens && Date.now() - tokens.at < HALF_DAY) return tokens.bySymbol;
  loading ??= (async () => {
    const res = await f(`${HOST}/script-details/1.0/masterscrip/file-paths`, { headers: headersOf(token) });
    const body = (await res.json()) as { data?: { filesPaths?: string[] } };
    const url = body.data?.filesPaths?.find((p) => /nse_cm/i.test(p));
    if (!url) throw new Error("No NSE scrip master");
    const csv = await (await f(url)).text();
    const bySymbol = parseScripMaster(csv);
    tokens = { at: Date.now(), bySymbol };
    return bySymbol;
  })().finally(() => {
    loading = null;
  });
  return loading;
}

/** Live prices for NSE shares by symbol ("ITC"): last price and the previous close, in rupees. */
export async function kotakPrices(token: string, symbols: string[], f: Fetch = fetch): Promise<Record<string, { price: number; prevClose: number | null }>> {
  const map = await scripMaster(token, f);
  const wanted = symbols.map((s) => ({ s, tok: map.get(s.toUpperCase()) })).filter((x): x is { s: string; tok: string } => !!x.tok);
  const out: Record<string, { price: number; prevClose: number | null }> = {};
  // Kotak takes at most 50 a call.
  for (let i = 0; i < wanted.length; i += 50) {
    const batch = wanted.slice(i, i + 50);
    const list = batch.map((x) => `nse_cm|${x.tok}`).join(",");
    const res = await f(`${HOST}/script-details/1.0/quotes/neosymbol/${encodeURIComponent(list).replace(/%7C/gi, "|").replace(/%2C/gi, ",")}/all`, { headers: headersOf(token) });
    if (!res.ok) continue;
    const rows = (await res.json()) as { exchange_token?: string; ltp?: string; change?: string; ohlc?: { close?: string } }[];
    for (const row of Array.isArray(rows) ? rows : []) {
      const hit = batch.find((x) => x.tok === row.exchange_token);
      const price = Number(row.ltp);
      if (!hit || !Number.isFinite(price) || price <= 0) continue;
      const change = Number(row.change);
      out[hit.s.toUpperCase()] = { price, prevClose: Number.isFinite(change) ? Math.round((price - change) * 100) / 100 : null };
    }
  }
  return out;
}

/** Daily closes (rupees, by date) for an NSE share since `from`; Kotak keeps up to 180 days of daily candles. */
export async function kotakDailyCloses(token: string, symbol: string, from: string, today: string, f: Fetch = fetch): Promise<Record<string, number>> {
  const map = await scripMaster(token, f);
  const tok = map.get(symbol.toUpperCase());
  if (!tok) return {};
  const earliest = new Date(Date.parse(`${today}T00:00:00Z`) - 179 * 86_400_000).toISOString().slice(0, 10);
  const q = new URLSearchParams({ neosymbol: `nse_cm|${tok}`, interval: "D", fromdate: from < earliest ? earliest : from, todate: today });
  const res = await f(`${HOST}/market-data/1.0/historical/details?${q}`, { headers: headersOf(token) });
  if (!res.ok) return {};
  const body = (await res.json()) as { data?: { candles?: (string | number)[][] } };
  const out: Record<string, number> = {};
  for (const c of body.data?.candles ?? []) {
    const date = String(c[0]).slice(0, 10);
    const close = Number(c[4]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(close) && close > 0) out[date] = close;
  }
  return out;
}
