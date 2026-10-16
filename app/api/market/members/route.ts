import { BY_SYMBOL } from "@/lib/market/catalog";
import { cacheFor, getMembers, PRICE_TTL_S } from "@/lib/market/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/market/members?symbol=^NSEI — the index's companies with price, size, PE, PB and dividend yield. */
export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol") ?? "";
  if (!BY_SYMBOL[symbol]) return Response.json({ error: "Unknown index" }, { status: 400 });
  try {
    return Response.json(await getMembers(symbol), { headers: { "cache-control": cacheFor(PRICE_TTL_S) } });
  } catch {
    return Response.json({ error: "Couldn't load this index's companies" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
