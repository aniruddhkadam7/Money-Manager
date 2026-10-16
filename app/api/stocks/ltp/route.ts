import { cacheFor, getLtp, LTP_TTL_S, SYMBOL_RE } from "@/lib/stocks/service";

export const dynamic = "force-dynamic";

/** GET /api/stocks/ltp?symbols=RELIANCE.NS,INFY.NS — last traded prices for open positions, fresh to within seconds. */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("symbols") ?? "";
  const symbols = [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => SYMBOL_RE.test(s)))].sort().slice(0, 40);
  if (!symbols.length) return Response.json({ error: "No symbols" }, { status: 400 });
  const body = await getLtp(symbols);
  const ok = Object.keys(body.prices).length > 0;
  return Response.json(body, { status: ok ? 200 : 502, headers: { "cache-control": ok ? cacheFor(LTP_TTL_S) : "no-store" } });
}
