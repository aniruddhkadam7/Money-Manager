import { cacheFor, getOverview, PRICE_TTL_S } from "@/lib/market/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/market/overview — every index, sector, rate, currency and commodity on the Market page.
 * The same for everyone, so the CDN keeps one copy for half an hour and serves all visitors from it.
 */
export async function GET() {
  try {
    return Response.json(await getOverview(), { headers: { "cache-control": cacheFor(PRICE_TTL_S) } });
  } catch {
    return Response.json({ error: "Market data isn't available right now" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
