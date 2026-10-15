import { cacheFor, getValuation, PRICE_TTL_S } from "@/lib/market/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/market/valuation — PEs: NSE's for each index, each sector's from its stocks and the world's, each stock's and its industry's. */
export async function GET() {
  try {
    const body = await getValuation();
    return Response.json(body, { headers: { "cache-control": body.complete ? cacheFor(PRICE_TTL_S) : "no-store" } });
  } catch {
    return Response.json({ error: "Valuations aren't available right now" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
