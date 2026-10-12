import { cacheFor, ECONOMY_TTL_S, getEconomy } from "@/lib/market/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/market/economy — growth, inflation, jobs, debt and central bank rates (IMF, BIS). Changes monthly at most. */
export async function GET() {
  try {
    const body = await getEconomy();
    // Missing some figures (a source was down): the CDN only keeps it a few minutes, so the gap fills soon.
    return Response.json(body, { headers: { "cache-control": cacheFor(body.complete ? ECONOMY_TTL_S : 600) } });
  } catch {
    return Response.json({ error: "Economic data isn't available right now" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
