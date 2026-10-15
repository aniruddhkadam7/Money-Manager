import type { MarketRange, Quote } from "./types";

/** Indices are points, not money: no currency sign; bond yields are percentages. Everything else in its own currency, Indian grouping. */
export function formatPrice(value: number, q: Pick<Quote, "currency" | "kind">): string {
  if (q.kind === "yield") return `${value.toFixed(2)}%`;
  const digits = Math.abs(value) < 1 ? 4 : 2;
  const opts: Intl.NumberFormatOptions = { minimumFractionDigits: digits, maximumFractionDigits: digits };
  if (q.kind === "index" || !q.currency) return value.toLocaleString("en-IN", opts);
  try {
    return new Intl.NumberFormat("en-IN", { ...opts, style: "currency", currency: q.currency }).format(value);
  } catch {
    return `${value.toLocaleString("en-IN", opts)} ${q.currency}`;
  }
}

const sign = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");

/** "+156.75" / "−0.70%": the sign spelled out, a true minus. */
export function formatChange(value: number): string {
  const digits = Math.abs(value) < 1 && value !== 0 ? 4 : 2;
  return `${sign(value)}${Math.abs(value).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function formatPct(value: number, digits = 2): string {
  return `${sign(value)}${Math.abs(value).toFixed(digits)}%`;
}

/** A return that may be missing (not enough history): a dash then. */
export const formatReturn = (value: number | null) => (value === null ? "—" : formatPct(value, Math.abs(value) >= 100 ? 0 : 1));

/**
 * A quote's return over a period, as shown beside it. A bond yield is already a percentage, so its move
 * reads in percentage points (4.00% to 4.25% is +0.25 pp, not +6.3%).
 */
export function formatQuoteReturn(q: Pick<Quote, "kind" | "price">, pctChange: number | null): string {
  if (pctChange === null || q.kind !== "yield") return formatReturn(pctChange);
  const before = q.price / (1 + pctChange / 100);
  return formatPoints(q.price - before);
}

/** A rate move in percentage points: "+0.25 pp", "−0.50 pp". */
export const formatPoints = (value: number) => `${sign(value)}${Math.abs(value).toFixed(2)} pp`;

/** "2026-09" -> "Sep 2026". */
export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
}

export const toneOf = (change: number | null) => (!change ? "neutral" : change > 0 ? "positive" : "negative") as "positive" | "negative" | "neutral";

/** Chart axes: 22.4K, 80.2L. */
export function formatAxis(value: number): string {
  return new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: Math.abs(value) < 100 ? 2 : 1 }).format(value);
}

function inZone(seconds: number, timeZone: string, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat("en-IN", { ...opts, timeZone }).format(seconds * 1000);
  } catch {
    return new Intl.DateTimeFormat("en-IN", opts).format(seconds * 1000);
  }
}

/** A point's label under the chart: the time for a day, the date for weeks and months, the month for years. */
export function axisTime(seconds: number, range: MarketRange, timeZone: string): string {
  if (range === "1d") return inZone(seconds, timeZone, { hour: "numeric", minute: "2-digit" });
  if (range === "1y" || range === "5y") return inZone(seconds, timeZone, { month: "short", year: "2-digit" });
  return inZone(seconds, timeZone, { day: "numeric", month: "short" });
}

/** A point's label on the hover card: as exact as the data. */
export function pointTime(seconds: number, range: MarketRange, timeZone: string, daily = false): string {
  if (range === "1d") return inZone(seconds, timeZone, { hour: "numeric", minute: "2-digit" });
  if (range === "5d" && !daily) return inZone(seconds, timeZone, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return inZone(seconds, timeZone, { day: "numeric", month: "short", year: "numeric" });
}

/** "2:41 pm" today, "9 Oct, 3:30 pm" before then, in India time (where the user is). */
export function updatedAt(seconds: number, now = Date.now() / 1000): string {
  const sameDay = inZone(seconds, "Asia/Kolkata", { dateStyle: "short" }) === inZone(now, "Asia/Kolkata", { dateStyle: "short" });
  return inZone(seconds, "Asia/Kolkata", sameDay ? { hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** A PE as shown: one decimal, a dash when there's none. */
export const formatPe = (pe: number | null | undefined) => (pe == null ? "—" : pe >= 100 ? pe.toFixed(0) : pe.toFixed(1));
