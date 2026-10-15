import { z } from "zod";
import type { GroupPe } from "./types";
import type { Fundamentals } from "./yahoo";

/**
 * Valuations. NSE publishes each of its indices' PE, PB and dividend yield every day in its list of
 * all indices (free, no key). Groups NSE doesn't publish (an industry, or a sector rebuilt from its
 * stocks) are worked out the way an index's PE is: the stocks' total value ÷ their total earnings.
 */
const URL = "https://www.nseindia.com/api/allIndices";

const Figure = z.union([z.string(), z.number()]).nullish();
const AllIndices = z.object({
  timestamp: z.string().nullish(),
  data: z.array(z.object({ index: z.string(), pe: Figure, pb: Figure, dy: Figure })),
});

export interface NseIndexFigures {
  pe: number | null;
  pb: number | null;
  dy: number | null;
}

/** NSE writes figures as text, and "0" or "-" where it has none (India VIX). */
const figure = (v: string | number | null | undefined) => {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function parseNseIndices(json: unknown): { asOf: string | null; indices: Record<string, NseIndexFigures> } {
  const body = AllIndices.parse(json);
  const indices: Record<string, NseIndexFigures> = {};
  for (const d of body.data) indices[d.index.toUpperCase()] = { pe: figure(d.pe), pb: figure(d.pb), dy: figure(d.dy) };
  if (!Object.keys(indices).length) throw new Error("No indices");
  return { asOf: body.timestamp ?? null, indices };
}

export async function fetchNseIndices() {
  const res = await fetch(URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": "Mozilla/5.0 (compatible; MoneyManager/1.0)", accept: "application/json" },
  });
  if (!res.ok) throw new Error(`NSE answered ${res.status}`);
  return parseNseIndices(await res.json());
}

/**
 * A group's PE: total company value ÷ total earnings over the last four quarters (earnings per share ×
 * shares). Loss-makers count with their losses, as in an index; stocks without figures are left out.
 */
export function groupPe(stocks: (Fundamentals | undefined)[]): GroupPe {
  let value = 0;
  let earnings = 0;
  let count = 0;
  for (const f of stocks) {
    if (!f?.marketCap || !f.shares || f.eps === null) continue;
    value += f.marketCap;
    earnings += f.eps * f.shares;
    count++;
  }
  return { pe: count && earnings > 0 ? value / earnings : null, count, total: stocks.length };
}
