/**
 * Kotak Neo, read only: your trades, holdings and positions, through Kotak's Neo Trade API (the same calls as their
 * official Python SDK, kotak-neo-python). Server side only: the Trade API token (KOTAK_NEO_TOKEN), mobile number
 * (KOTAK_NEO_MOBILE) and client code (KOTAK_NEO_UCC) stay on the server; the day's TOTP and your MPIN come with each
 * sync and are never stored. Nothing here places, changes or cancels an order.
 */

const LOGIN_BASE = "https://mis.kotaksecurities.com";
const FIN_KEY = "neotradeapi";

export interface KotakConfig {
  token: string;
  mobile: string;
  ucc: string;
  /**
   * Logging in by itself, no TOTP to type: the TOTP secret key (KOTAK_NEO_TOTP_SECRET, base32, from when TOTP was
   * registered) and the MPIN (KOTAK_NEO_MPIN). Only when both are set.
   */
  auto?: { totpSecret: string; mpin: string };
}

export function kotakConfig(env: Record<string, string | undefined>): KotakConfig | null {
  const token = env.KOTAK_NEO_TOKEN?.trim();
  const mobile = env.KOTAK_NEO_MOBILE?.trim();
  const ucc = env.KOTAK_NEO_UCC?.trim();
  if (!token || !mobile || !ucc) return null;
  const totpSecret = env.KOTAK_NEO_TOTP_SECRET?.trim();
  const mpin = env.KOTAK_NEO_MPIN?.trim();
  return { token, mobile, ucc, ...(totpSecret && mpin && /^\d{4,6}$/.test(mpin) ? { auto: { totpSecret, mpin } } : {}) };
}

/** A trade from the trade book, ready to become an entry. */
export interface KotakTrade {
  /** Kotak's own reference (order number and fill), so a trade is never added twice. */
  ref: string;
  symbol: string;
  exchange: "NSE" | "BSE";
  side: "buy" | "sell";
  quantity: number;
  /** Price per share, in paise. */
  priceMinor: number;
  date: string;
  time?: string;
  product: "intraday" | "delivery";
}

export interface KotakHolding {
  symbol: string;
  quantity: number;
  avgPriceMinor: number;
  closePriceMinor: number;
  valueMinor: number;
}

/** Your funds with Kotak, as its "limits" report them (all segments). */
export interface KotakFunds {
  /** What you can trade with now ("Net": cash and collateral less what's used). */
  availableMinor: number;
  marginUsedMinor: number;
  /** Value of pledged shares counted as margin. */
  collateralMinor: number;
  /** Money added and taken out today. */
  payInMinor: number;
  payOutMinor: number;
}

/** A position for the day, as Kotak shows it: open (shares still held or short) or closed (squared off). */
export interface KotakPosition {
  symbol: string;
  /** "NSE", "BSE", or the segment for F&O and others ("NSE F&O"…). */
  market: string;
  product: string;
  buyQty: number;
  sellQty: number;
  /** Average prices, in paise (0 when none). */
  buyAvgMinor: number;
  sellAvgMinor: number;
  /** Positive long, negative short, 0 when closed. */
  netQty: number;
  /** Profit on the quantity bought and sold (before charges), in paise. */
  realizedMinor: number;
}

export interface KotakSync {
  trades: KotakTrade[];
  holdings: KotakHolding[];
  positions: KotakPosition[];
  /** Null when Kotak didn't give them (the rest of the sync still stands). */
  funds: KotakFunds | null;
  /** Trades not in shares on NSE/BSE (F&O, currency…), which the Invest tab doesn't track: just counted. */
  skipped: number;
}

export class KotakError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;
type Json = Record<string, unknown>;

const paise = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** Kotak's dates ("26-Nov-2026", "26/11/2026", "2026-11-26", sometimes with a time) as YYYY-MM-DD. */
export function kotakDate(raw: unknown, fallback: string): string {
  const s = String(raw ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return fallback;
}

/** "RELIANCE-EQ" → "RELIANCE". */
const cleanSymbol = (s: unknown) => String(s ?? "").trim().toUpperCase().replace(/-(EQ|BE|BZ|SM|ST)$/, "");

/** The trade book's rows as trades in shares; others are counted as skipped. */
export function parseTrades(rows: Json[], today: string): { trades: KotakTrade[]; skipped: number } {
  const trades: KotakTrade[] = [];
  let skipped = 0;
  for (const r of rows) {
    const seg = String(r.exSeg ?? "").toLowerCase();
    const exchange = seg === "nse_cm" ? "NSE" : seg === "bse_cm" ? "BSE" : null;
    const side = r.trnsTp === "B" ? "buy" : r.trnsTp === "S" ? "sell" : null;
    const quantity = Number(r.fldQty);
    const priceMinor = paise(r.avgPrc);
    const symbol = cleanSymbol(r.trdSym || r.sym);
    if (!exchange || !side || !Number.isInteger(quantity) || quantity <= 0 || priceMinor <= 0 || !symbol) {
      skipped++;
      continue;
    }
    const time = String(r.flTm ?? "").match(/\d{2}:\d{2}(:\d{2})?/)?.[0];
    trades.push({
      ref: `kotak:${r.nOrdNo ?? ""}:${r.flId ?? r.exOrdId ?? ""}`,
      symbol,
      exchange,
      side,
      quantity,
      priceMinor,
      date: kotakDate(r.flDt ?? r.exTm, today),
      ...(time ? { time } : {}),
      product: String(r.prod ?? "").toUpperCase() === "MIS" ? "intraday" : "delivery",
    });
  }
  return { trades, skipped };
}

export function parseFunds(body: Json): KotakFunds | null {
  if (body.Net === undefined && body.MarginUsed === undefined) return null;
  return {
    availableMinor: paise(body.Net),
    marginUsedMinor: paise(body.MarginUsed),
    collateralMinor: paise(body.CollateralValue ?? body.Collateral),
    payInMinor: paise(body.RmsPayInAmt),
    payOutMinor: paise(body.RmsPayOutAmt),
  };
}

const SEGMENT: Record<string, string> = { nse_cm: "NSE", bse_cm: "BSE", nse_fo: "NSE F&O", bse_fo: "BSE F&O", cde_fo: "Currency", mcx_fo: "MCX" };

export function parsePositions(rows: Json[]): KotakPosition[] {
  return rows
    .map((r) => {
      const n = (v: unknown) => Number(v ?? 0) || 0;
      const mult = (n(r.multiplier) || 1) * (n(r.genNum) || 1) / (n(r.genDen) || 1) * (n(r.prcNum) || 1) / (n(r.prcDen) || 1);
      const buyQty = n(r.cfBuyQty) + n(r.flBuyQty);
      const sellQty = n(r.cfSellQty) + n(r.flSellQty);
      const buyAmt = n(r.cfBuyAmt) + n(r.buyAmt);
      const sellAmt = n(r.cfSellAmt) + n(r.sellAmt);
      const buyAvg = buyQty ? buyAmt / buyQty / mult : 0;
      const sellAvg = sellQty ? sellAmt / sellQty / mult : 0;
      const closed = Math.min(buyQty, sellQty);
      return {
        symbol: cleanSymbol(r.trdSym || r.sym),
        market: SEGMENT[String(r.exSeg ?? "").toLowerCase()] ?? String(r.exSeg ?? "").toUpperCase(),
        product: String(r.prod ?? "").toUpperCase(),
        buyQty,
        sellQty,
        buyAvgMinor: Math.round(buyAvg * 100),
        sellAvgMinor: Math.round(sellAvg * 100),
        netQty: buyQty - sellQty,
        realizedMinor: closed ? Math.round(closed * (sellAvg - buyAvg) * mult * 100) : 0,
      };
    })
    .filter((p) => p.symbol && (p.buyQty > 0 || p.sellQty > 0));
}

export function parseHoldings(rows: Json[]): KotakHolding[] {
  return rows
    .map((r) => ({
      symbol: cleanSymbol(r.displaySymbol || r.symbol),
      quantity: Number(r.quantity ?? 0),
      avgPriceMinor: paise(r.averagePrice),
      closePriceMinor: paise(r.closingPrice),
      valueMinor: paise(r.mktValue),
    }))
    .filter((h) => h.symbol && h.quantity > 0);
}

/** Kotak's message for a failed call (every one it gives, with its code), or ours. */
function failure(body: Json | null, fallback: string): string {
  const list = Array.isArray(body?.error) ? (body!.error as Json[]) : [];
  const fromList = list.map((e) => [e?.message, e?.code ? `(${e.code})` : ""].filter(Boolean).join(" ")).filter(Boolean);
  const msg = fromList.length ? fromList.join("; ") : (body?.message ?? body?.errMsg ?? (body?.error as Json | undefined)?.message);
  return typeof msg === "string" && msg.trim() ? msg.trim() : fallback;
}

async function call(f: Fetch, url: string, init: RequestInit, what: string): Promise<Json> {
  let res: Response;
  try {
    res = await f(url, { ...init, headers: { accept: "application/json", ...(init.headers as Record<string, string>) } });
  } catch {
    throw new KotakError(`Couldn't reach Kotak Neo (${what}).`);
  }
  const body = (await res.json().catch(() => null)) as Json | null;
  // "No Data", "No holdings found…": nothing to list, not a failure.
  if (/^no (data|records?|holdings?|trades?|positions?|orders?)\b/i.test(failure(body, ""))) return { data: [] };
  if (!res.ok || (body && (body.stat === "Not_Ok" || body.status === "error"))) {
    console.error("kotak neo:", what, "answered", res.status);
    throw new KotakError(`${what}: ${failure(body, `refused (${res.status})`)}`, res.status === 401 || res.status === 403 || res.status === 424 ? 401 : 502);
  }
  return body ?? {};
}

/** The day's session after logging in: what the reads need (it lasts the trading day). */
export interface KotakSession {
  sid: string;
  token: string;
  base: string;
}

/** Logs in with the day's TOTP and your MPIN. */
export async function kotakLogin(cfg: KotakConfig, totp: string, mpin: string, f: Fetch = fetch): Promise<KotakSession> {
  const json = { "content-type": "application/json", "neo-fin-key": FIN_KEY, authorization: cfg.token };
  const login = await call(f, `${LOGIN_BASE}/login/1.0/tradeApiLogin`, { method: "POST", headers: json, body: JSON.stringify({ mobileNumber: cfg.mobile, ucc: cfg.ucc, totp }) }, "Login");
  const view = (login.data ?? {}) as Json;
  if (typeof view.token !== "string" || typeof view.sid !== "string") throw new KotakError("Kotak Neo didn't accept the TOTP.", 401);

  const validated = await call(
    f,
    `${LOGIN_BASE}/login/1.0/tradeApiValidate`,
    { method: "POST", headers: { ...json, sid: view.sid, Auth: view.token }, body: JSON.stringify({ mpin }) },
    "MPIN check",
  );
  const trade = (validated.data ?? {}) as Json;
  if (typeof trade.token !== "string" || typeof trade.sid !== "string") throw new KotakError("Kotak Neo didn't accept the MPIN.", 401);
  const base = (typeof trade.baseUrl === "string" && trade.baseUrl.startsWith("https://") ? trade.baseUrl : LOGIN_BASE).replace(/\/+$/, "");
  return { sid: trade.sid, token: trade.token, base };
}

/** Reads trades, holdings, funds and positions with the day's session (reads only). */
export async function kotakRead(s: KotakSession, today: string, f: Fetch = fetch): Promise<KotakSync> {
  // Only Kotak's own servers: a session never goes anywhere else.
  if (!/^https:\/\/[a-z0-9.-]+\.kotaksecurities\.com$/i.test(s.base)) throw new KotakError("Unexpected Kotak server.", 400);
  const session = { Sid: s.sid, Auth: s.token };
  const base = s.base;
  const form = { ...session, "content-type": "application/x-www-form-urlencoded" };
  // The trade book is what the sync is for; the rest is shown when Kotak gives it (a failure there doesn't stop the sync).
  const [book, holdings, limits, positions] = await Promise.all([
    call(f, `${base}/quick/user/trades`, { method: "GET", headers: session }, "Trade book"),
    call(f, `${base}/portfolio/v1/holdings`, { method: "GET", headers: form }, "Holdings").catch(() => null),
    // Funds: a read too (Kotak takes it as a POST with the segments in jData). Its failure doesn't stop the sync.
    call(f, `${base}/quick/user/limits`, { method: "POST", headers: form, body: `jData=${encodeURIComponent(JSON.stringify({ seg: "ALL", exch: "ALL", prod: "ALL" }))}` }, "Funds").catch(() => null),
    call(f, `${base}/quick/user/positions`, { method: "GET", headers: session }, "Positions").catch(() => null),
  ]);
  const { trades, skipped } = parseTrades(Array.isArray(book.data) ? (book.data as Json[]) : [], today);
  const list = (r: Json | null) => (r && Array.isArray(r.data) ? (r.data as Json[]) : []);
  return { trades, holdings: parseHoldings(list(holdings)), positions: parsePositions(list(positions)), funds: limits ? parseFunds(limits) : null, skipped };
}

/** Logs in with the day's TOTP and your MPIN, then reads everything. */
export async function kotakSync(cfg: KotakConfig, totp: string, mpin: string, today: string, f: Fetch = fetch): Promise<KotakSync & { session: KotakSession }> {
  const session = await kotakLogin(cfg, totp, mpin, f);
  return { ...(await kotakRead(session, today, f)), session };
}
