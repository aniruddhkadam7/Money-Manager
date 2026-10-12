import { cacheFor, getChart, SYMBOL_RE } from "@/lib/market/service";
import type { MarketRange } from "@/lib/market/types";

export const dynamic = "force-dynamic";

/** How long each range's chart is kept, in seconds: a long range barely changes in a day. */
const KEEP: Record<MarketRange, number> = { "1d": 1800, "5d": 3600, "1mo": 7200, "6mo": 21600, "1y": 21600, "5y": 43200 };

/** GET /api/market/chart?symbol=^NSEI&range=1y — the price over that range, for the big chart. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = params.get("symbol") ?? "";
  const range = params.get("range") as MarketRange;
  if (!SYMBOL_RE.test(symbol) || !(range in KEEP)) return Response.json({ error: "Bad symbol or range" }, { status: 400 });
  try {
    return Response.json(await getChart(symbol, range), { headers: { "cache-control": cacheFor(KEEP[range]) } });
  } catch {
    return Response.json({ error: "Couldn't load that chart" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
