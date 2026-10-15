import type { PricePoint } from "./types";

/**
 * India's own gold and silver rates, from the India Bullion and Jewellers Association (ibjarates.com):
 * the benchmark banks and jewellers quote, published twice a working day (around noon and 6 PM). It
 * includes import duty but not GST or making charges. The home page carries today's rates and about
 * four months of daily ones, so one request gives the price and its recent history.
 */
const URL = "https://ibjarates.com/";

export type Metal = "gold999" | "silver999";

export interface IbjaMetal {
  /** Daily rates, oldest first, the latest last (₹ per 10 g of gold, per kg of silver). */
  history: PricePoint[];
  /** Which of the day's two rates the latest is. */
  session: "AM" | "PM";
}

/** An IBJA rate is published around 6 PM in India (12:30 UTC); a date's point sits there. */
function dayTime(label: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(label);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], 12, 30) / 1000 : null;
}

function hidden(html: string, id: string): Record<string, unknown> {
  const m = new RegExp(`id="${id}"\\s+value="([^"]*)"`).exec(html);
  if (!m) throw new Error(`No ${id} on IBJA's page`);
  return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&")) as Record<string, unknown>;
}

function rate(html: string, id: string): number | null {
  const m = new RegExp(`id="${id}"[^>]*>\\s*([\\d.,]+)\\s*<`).exec(html);
  const n = m ? Number.parseFloat(m[1].replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function metal(html: string, chart: string, series: string, label: string, now: number): IbjaMetal {
  const data = hidden(html, chart);
  const labels = data.labels;
  const values = data[series];
  if (!Array.isArray(labels) || !Array.isArray(values)) throw new Error(`Unexpected ${chart} on IBJA's page`);
  const history: PricePoint[] = [];
  labels.forEach((l, i) => {
    const t = typeof l === "string" ? dayTime(l) : null;
    const v = Number(values[i]);
    if (t !== null && Number.isFinite(v) && v > 0) history.push({ t, v });
  });
  const pm = rate(html, `lbl${label}_PM`);
  const am = rate(html, `lbl${label}_AM`);
  const latest = pm ?? am;
  // Today's table is newer than the history when its rate isn't the history's last one: it's from today.
  if (latest !== null && latest !== history.at(-1)?.v) history.push({ t: now, v: latest });
  if (history.length < 2) throw new Error(`Too few ${label} rates on IBJA's page`);
  return { history, session: pm !== null || am === null ? "PM" : "AM" };
}

export function parseIbja(html: string, now = Math.floor(Date.now() / 1000)): Record<Metal, IbjaMetal> {
  return {
    gold999: metal(html, "HdnGold", "purity999", "Gold999", now),
    silver999: metal(html, "HdnSilver", "silverRate", "Silver999", now),
  };
}

export async function fetchIbja(): Promise<Record<Metal, IbjaMetal>> {
  const res = await fetch(URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": "Mozilla/5.0 (compatible; MoneyManager/1.0)", accept: "text/html" },
  });
  if (!res.ok) throw new Error(`IBJA answered ${res.status}`);
  return parseIbja(await res.text());
}

/**
 * IBJA's rates with older history before them: `older` (the world price in rupees) scaled so it meets
 * IBJA's first rate, so returns over a year still read, at India's price level.
 */
export function spliceHistory(older: PricePoint[], ibja: PricePoint[]): PricePoint[] {
  const start = ibja[0];
  if (!start) return older;
  const before = older.filter((p) => p.t < start.t);
  const join = before.at(-1)?.v;
  if (!join) return ibja;
  const k = start.v / join;
  return [...before.map((p) => ({ t: p.t, v: p.v * k })), ...ibja];
}
