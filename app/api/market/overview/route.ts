import { cacheFor, getOverview, PRICE_TTL_S } from "@/lib/market/service";

export const dynamic = "force-dynamic";

/** GET /api/market/overview — Nifty 50, Bank Nifty, Nifty 100 and every Nifty sector index, today. */
export async function GET() {
  try {
    return Response.json(await getOverview(), { headers: { "cache-control": cacheFor(PRICE_TTL_S) } });
  } catch {
    return Response.json({ error: "Market prices aren't available right now" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
