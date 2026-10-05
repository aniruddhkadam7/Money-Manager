/** All dates are local calendar dates as `YYYY-MM-DD`; months are `YYYY-MM`. */

const pad = (n: number) => String(n).padStart(2, "0");

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function currentMonthKey(): string {
  return monthKey(todayISO());
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function parse(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** e.g. "Sun, 4 Oct 2026" */
export function formatWeekdayDate(isoDate: string): string {
  return parse(isoDate).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** e.g. "4 Oct 2026" */
export function formatDisplayDate(isoDate: string): string {
  return parse(isoDate).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** e.g. "October 2026" */
export function formatMonthLong(ym: string): string {
  return parse(`${ym}-01`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

/** e.g. "Oct" */
export function formatMonthShort(ym: string): string {
  return parse(`${ym}-01`).toLocaleDateString("en-IN", { month: "short" });
}

/** Adds (or subtracts) whole days to a `YYYY-MM-DD` date. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return toISODate(new Date(y, m - 1, d + days));
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export function monthStart(ym: string): string {
  return `${ym}-01`;
}

/** Last calendar day of the month, e.g. "2026-02-28". */
export function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return toISODate(new Date(y, m, 0));
}

/** e.g. "4 Oct" */
export function formatDayMonth(isoDate: string): string {
  return parse(isoDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** e.g. "Sept 2026" style short month + year: "Oct 2026" */
export function formatMonthYear(ym: string): string {
  return parse(`${ym}-01`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

/** e.g. "Mon" */
export function formatWeekdayShort(isoDate: string): string {
  return parse(isoDate).toLocaleDateString("en-IN", { weekday: "short" });
}

/** e.g. "October 4" */
export function formatLongDayMonth(isoDate: string): string {
  return parse(isoDate).toLocaleDateString("en-IN", { month: "long", day: "numeric" });
}
