import { cacheFor, getSector, PRICE_TTL_S, SYMBOL_RE } from "@/lib/market/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/market/sector?symbol=^CNXAUTO — the stocks in that Nifty sector, with their returns. */
export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol") ?? "";
  if (!SYMBOL_RE.test(symbol)) return Response.json({ error: "Bad symbol" }, { status: 400 });
  try {
    return Response.json(await getSector(symbol), { headers: { "cache-control": cacheFor(PRICE_TTL_S) } });
  } catch {
    return Response.json({ error: "Couldn't load this sector's stocks" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
