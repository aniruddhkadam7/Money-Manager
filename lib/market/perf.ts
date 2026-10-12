import type { Performance, Period, PricePoint } from "./types";

const DAY = 86_400;

/** How far back each period reaches, in days. */
const PERIOD_DAYS = { "1w": 7, "1m": 30, "3m": 91, "1y": 365 } as const;

/**
 * The close the day's change is measured from, from a run of daily closes. When the last close is
 * today's (the market is open, or closed after trading today), it's the one before; otherwise the
 * last one is yesterday's and the price has moved on from it.
 */
export function prevCloseFromDaily(points: PricePoint[], marketTime: number, gmtoffset: number): number | null {
  const n = points.length;
  if (n === 0) return null;
  const day = (t: number) => Math.floor((t + gmtoffset) / DAY);
  if (day(points[n - 1].t) === day(marketTime)) return n >= 2 ? points[n - 2].v : null;
  return points[n - 1].v;
}

/** The close at or just before `t`; null when the history doesn't reach back that far (a few days' grace). */
function valueAt(points: PricePoint[], t: number): number | null {
  if (!points.length || points[0].t > t + 5 * DAY) return null;
  let found = points[0].v;
  for (const p of points) {
    if (p.t > t) break;
    found = p.v;
  }
  return found;
}

const pct = (from: number | null, to: number) => (from ? ((to - from) / from) * 100 : null);

/**
 * Percent change over each period. `history` may be another series (a sector's ETF) than the one
 * `price` belongs to: returns compare its own last close with its own past.
 */
export function performance(history: PricePoint[], price: number, prevClose: number | null): Performance {
  const last = history.at(-1);
  const now = last?.t ?? 0;
  const from = (days: number) => (last ? pct(valueAt(history, now - days * DAY), last.v) : null);
  return {
    "1d": prevClose ? pct(prevClose, price) : null,
    "1w": from(PERIOD_DAYS["1w"]),
    "1m": from(PERIOD_DAYS["1m"]),
    "3m": from(PERIOD_DAYS["3m"]),
    "1y": from(PERIOD_DAYS["1y"]),
  };
}

/**
 * The small trend line's data: up to a year of daily closes (the latest last), to five significant
 * figures (plenty for a line 70 pixels wide, and it keeps the answer small). The page cuts it to the
 * period being shown with sparkFor.
 */
export function dailySpark(points: PricePoint[], max = 260): number[] {
  return points.slice(-max).map((p) => Number(p.v.toPrecision(5)));
}

/** How many of the latest daily closes make up each period's line (a day has no intraday line here, so it shows the week). */
const SPARK_DAYS: Record<Period, number> = { "1d": 6, "1w": 6, "1m": 23, "3m": 64, "1y": Infinity };

export function sparkFor(spark: number[], period: Period): number[] {
  const n = SPARK_DAYS[period];
  return n >= spark.length ? spark : spark.slice(-n);
}

/**
 * An index from its members' closes, chained from 100: each day, the members' moves since their last
 * close, averaged. With `shares` (each member's share count) the average is weighted by company size
 * at the previous close, the way NSE's indices are; without, every member counts the same. A member
 * that starts trading part-way simply joins from then on. Days are told apart in India time.
 */
export function memberIndex(members: PricePoint[][], shares?: (number | null)[], gmtoffset = 19_800): PricePoint[] {
  const day = (t: number) => Math.floor((t + gmtoffset) / DAY);
  const byDay = new Map<number, { t: number; values: Map<number, number> }>();
  members.forEach((points, m) => {
    for (const p of points) {
      const d = day(p.t);
      const slot = byDay.get(d) ?? { t: p.t, values: new Map<number, number>() };
      slot.values.set(m, p.v);
      byDay.set(d, slot);
    }
  });
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const last = new Map<number, number>();
  let level = 100;
  const out: PricePoint[] = [];
  for (const d of days) {
    const { t, values } = byDay.get(d)!;
    let sum = 0;
    let weight = 0;
    for (const [m, v] of values) {
      const before = last.get(m);
      if (before) {
        const w = shares ? (shares[m] ?? 0) * before : 1;
        sum += w * (v / before - 1);
        weight += w;
      }
      last.set(m, v);
    }
    if (weight) level *= 1 + sum / weight;
    out.push({ t, v: level });
  }
  return out;
}

/** A dollar return seen in rupees: the asset's move and the dollar's move against the rupee, compounded. */
export function inRupees(usdPct: number | null, usdInrPct: number | null): number | null {
  if (usdPct === null || usdInrPct === null) return null;
  return ((1 + usdPct / 100) * (1 + usdInrPct / 100) - 1) * 100;
}
