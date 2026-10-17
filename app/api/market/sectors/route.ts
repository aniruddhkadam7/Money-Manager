import { cacheFor, getSectorHistory, HISTORY_RANGES, HISTORY_TTL_S } from "@/lib/market/service";
import type { HistoryRange } from "@/lib/market/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/market/sectors?range=1Y — every Nifty sector index's closes over 1M, 6M, 1Y or 5Y, on shared dates. */
export async function GET(request: Request) {
  const range = new URL(request.url).searchParams.get("range") ?? "1Y";
  if (!(range in HISTORY_RANGES)) return Response.json({ error: "Unknown range" }, { status: 400 });
  try {
    return Response.json(await getSectorHistory(range as HistoryRange), { headers: { "cache-control": cacheFor(HISTORY_TTL_S) } });
  } catch {
    return Response.json({ error: "Sector history isn't available right now" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
