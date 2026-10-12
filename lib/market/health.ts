import type { Economy, EconomyGroup, YearValue } from "./types";

/**
 * How an economy is doing, figure by figure, told honestly:
 * - the verdict rests on the latest *actual* year, never on a forecast (the IMF's figure for the year in
 *   progress is an estimate, and next year's a forecast: both are shown, marked as such);
 * - every verdict shows the range it was judged against (`zones`), so it can be checked at a glance;
 * - a figure the source only repeats unchanged year after year is shown but not judged.
 * The ranges are common rules of thumb (the RBI's inflation band, the 3%-of-GDP deficit and 60%-of-GDP
 * debt markers, three months of import cover), not forecasts or advice.
 */

export type Verdict = "good" | "watch" | "weak";

/** A stretch of values and the verdict it earns; from/to may be open-ended. */
export interface Zone {
  from: number;
  to: number;
  verdict: Verdict;
}

export interface Indicator {
  key: string;
  label: string;
  /** The years to draw, oldest first: outturns, then the IMF's estimate and forecast (marked `forecast`). */
  series: YearValue[];
  /** The latest year that has actually happened, which the verdict is about. */
  latest: YearValue | null;
  /** The year before it, for "up or down". */
  previous: YearValue | null;
  /** The IMF's figure for the year in progress (an estimate), if any. */
  outlook: YearValue | null;
  verdict: Verdict | null;
  /** The ranges, for shading the chart and for the caption. */
  zones: Zone[];
  /** "Healthy: 2–6% (the RBI's target band)". */
  rule: string;
  /** Better or worse than the year before, by the indicator's own sense of better. */
  trend: "better" | "worse" | "same" | null;
  /** Why there's no verdict, when there isn't one. */
  caveat?: string;
  /** For a figure judged by closeness to a target (inflation): the target, so the trend can say so. */
  target?: number;
  /** For a figure carried forward: the first year of the unchanged run, drawn grey (not measured, so not judged). */
  repeatedFrom?: number;
  format: (v: number) => string;
}

const INF = Number.POSITIVE_INFINITY;
const pct = (v: number) => `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;

const zoneOf = (zones: Zone[], v: number): Verdict | null => zones.find((z) => v >= z.from && v < z.to)?.verdict ?? null;

/** Better, worse or about the same, given which way is better (a number to move towards, or up/down). */
function trendOf(now: number, before: number | undefined, better: "up" | "down" | number, tolerance: number): Indicator["trend"] {
  if (before === undefined) return null;
  const score = (v: number) => (better === "up" ? v : better === "down" ? -v : -Math.abs(v - better));
  const d = score(now) - score(before);
  return Math.abs(d) < tolerance ? "same" : d > 0 ? "better" : "worse";
}

/**
 * A figure carried forward rather than measured: the same value, to the decimal, for at least the last
 * three actual years, and the forecasts carrying it on unchanged. (Two equal years, or a flat forecast
 * after real movement, happen with real data; three identical outturns running into a flat forecast don't.)
 */
function isRepeated(series: YearValue[]): boolean {
  const actual = series.filter((v) => !v.forecast);
  const latest = actual.at(-1);
  if (!latest) return false;
  const lastThree = actual.slice(-3);
  const forecasts = series.filter((v) => v.forecast);
  return lastThree.length === 3 && lastThree.every((v) => v.value === latest.value) && forecasts.length > 0 && forecasts.every((v) => v.value === latest.value);
}

/** The first year of the trailing run of identical values. */
function firstOfRun(series: YearValue[]): number {
  let i = series.length - 1;
  while (i > 0 && series[i - 1].value === series[i].value) i--;
  return series[i].year;
}

const GROWTH: Record<EconomyGroup, { good: number; watch: number; word: string }> = {
  emerging: { good: 5, watch: 3, word: "for a developing economy" },
  advanced: { good: 2, watch: 1, word: "for a mature economy" },
  world: { good: 3, watch: 2, word: "for the world" },
};

function inflationBand(code: string, group: EconomyGroup) {
  if (code === "IND") return { lo: 2, hi: 6, outerLo: 1, outerHi: 8, target: 4, note: "the RBI's target band" };
  if (group === "advanced") return { lo: 1, hi: 3, outerLo: 0, outerHi: 5, target: 2, note: "around the usual 2% target" };
  if (group === "world") return { lo: 2, hi: 4, outerLo: 1, outerHi: 6, target: 3, note: "" };
  return { lo: 2, hi: 5, outerLo: 1, outerHi: 7, target: 3.5, note: "" };
}

/** Old saved answers may lack newer fields: those indicators are simply left out. */
const list = (v: YearValue[] | undefined) => (Array.isArray(v) ? v : []);

function indicator(
  key: string,
  label: string,
  series: YearValue[],
  zones: Zone[],
  rule: string,
  better: "up" | "down" | number,
  format: (v: number) => string,
  tolerance = 0.1,
): Indicator | null {
  if (!series.length) return null;
  const actual = series.filter((v) => !v.forecast);
  const latest = actual.at(-1) ?? null;
  const previous = actual.at(-2) ?? null;
  const outlook = series.find((v) => v.forecast) ?? null;
  const repeated = isRepeated(series);
  return {
    key,
    label,
    series,
    latest,
    previous,
    outlook,
    verdict: latest && !repeated ? zoneOf(zones, latest.value) : null,
    zones,
    rule,
    trend: latest && !repeated ? trendOf(latest.value, previous?.value, better, tolerance) : null,
    caveat: repeated ? `The source repeats ${format(actual.at(-1)!.value)} every year: no fresh figure to judge` : undefined,
    target: typeof better === "number" ? better : undefined,
    repeatedFrom: repeated ? firstOfRun(series) : undefined,
    format,
  };
}

/** An economy's figures, each with its chart data, its verdict and the rule behind it. */
export function indicators(e: Economy): Indicator[] {
  const group: EconomyGroup = e.group ?? (e.code === "WEOWORLD" ? "world" : e.code === "IND" || e.code === "CHN" ? "emerging" : "advanced");
  const g = GROWTH[group];
  const b = inflationBand(e.code, group);
  const debtHigh = group === "advanced" ? 100 : 90;
  const out = [
    indicator(
      "growth",
      "Economic growth",
      list(e.gdpGrowth),
      [
        { from: g.good, to: INF, verdict: "good" },
        { from: g.watch, to: g.good, verdict: "watch" },
        { from: -INF, to: g.watch, verdict: "weak" },
      ],
      `Healthy: ${g.good}%+ ${g.word}`,
      "up",
      pct,
    ),
    indicator(
      "inflation",
      "Inflation",
      list(e.inflation),
      [
        { from: b.lo, to: b.hi, verdict: "good" },
        { from: b.outerLo, to: b.lo, verdict: "watch" },
        { from: b.hi, to: b.outerHi, verdict: "watch" },
        { from: -INF, to: b.outerLo, verdict: "weak" },
        { from: b.outerHi, to: INF, verdict: "weak" },
      ],
      `Healthy: ${b.lo}–${b.hi}%${b.note ? ` (${b.note})` : ""}`,
      b.target,
      pct,
    ),
    indicator(
      "jobs",
      "Unemployment",
      list(e.unemployment),
      [
        { from: -INF, to: 5, verdict: "good" },
        { from: 5, to: 8, verdict: "watch" },
        { from: 8, to: INF, verdict: "weak" },
      ],
      "Healthy: under 5%",
      "down",
      pct,
    ),
    indicator(
      "deficit",
      "Government budget",
      list(e.fiscalBalance),
      [
        { from: -3, to: INF, verdict: "good" },
        { from: -6, to: -3, verdict: "watch" },
        { from: -INF, to: -6, verdict: "weak" },
      ],
      "Healthy: a deficit under 3% of GDP",
      "up",
      signed,
    ),
    indicator(
      "debt",
      "Government debt",
      list(e.debt),
      [
        { from: -INF, to: 60, verdict: "good" },
        { from: 60, to: debtHigh, verdict: "watch" },
        { from: debtHigh, to: INF, verdict: "weak" },
      ],
      "Healthy: under 60% of GDP",
      "down",
      (v) => `${Math.round(v)}%`,
      0.5,
    ),
    indicator(
      "external",
      "Trade & income with the world",
      list(e.currentAccount),
      [
        { from: -2.5, to: INF, verdict: "good" },
        { from: -4, to: -2.5, verdict: "watch" },
        { from: -INF, to: -4, verdict: "weak" },
      ],
      "Healthy: a deficit under 2.5% of GDP",
      "up",
      signed,
    ),
    // Describes rather than judges: no zones, so no verdict, but its trend still shows.
    indicator("income", "Income per person", list(e.gdpPerCapita), [], "GDP per person, in US dollars", "up", (v) => `$${Math.round(v).toLocaleString("en-US")}`, 1),
  ];
  const items = out.filter((i): i is Indicator => i !== null);
  // A figure much older than the rest (a source that has stopped updating it) is shown but not judged as today's.
  const newest = Math.max(0, ...items.map((i) => i.latest?.year ?? 0));
  for (const i of items) {
    if (i.latest && i.latest.year < newest - 1 && i.verdict) {
      i.verdict = null;
      i.trend = null;
      i.caveat = `The latest figure is from ${i.latest.year}: too old to judge today`;
    }
  }
  return items;
}

/** Reserves come as one recent figure (World Bank), judged only for economies whose currency others don't hold. */
export function reservesVerdict(e: Economy): Verdict | null {
  if (!e.reserves || (e.group ?? "advanced") === "advanced") return null;
  const m = e.reserves.months;
  return m >= 6 ? "good" : m >= 3 ? "watch" : "weak";
}

/** How many verdicts of each kind (reserves included), and the latest year they're about. */
export function tally(e: Economy, list: Indicator[]): { counts: Record<Verdict, number>; year: number | null } {
  const counts: Record<Verdict, number> = { good: 0, watch: 0, weak: 0 };
  for (const i of list) if (i.verdict) counts[i.verdict]++;
  const r = reservesVerdict(e);
  if (r) counts[r]++;
  const years = list.filter((i) => i.verdict && i.latest).map((i) => i.latest!.year);
  return { counts, year: years.length ? Math.max(...years) : null };
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}
