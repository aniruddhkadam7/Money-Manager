import { cacheFor, getSectors, SYMBOL_RE } from "@/lib/stocks/service";

export const dynamic = "force-dynamic";

/** GET /api/stocks/sectors?symbols=ITC.NS,INFY.NS — each share's sector and industry (from Yahoo), for the Invest overview. */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("symbols") ?? "";
  const symbols = [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => SYMBOL_RE.test(s)))].sort().slice(0, 40);
  if (!symbols.length) return Response.json({ error: "No symbols" }, { status: 400 });
  const sectors = await getSectors(symbols);
  const ok = Object.keys(sectors).length > 0;
  return Response.json({ sectors }, { status: ok ? 200 : 502, headers: { "cache-control": ok ? cacheFor(24 * 3600) : "no-store" } });
}
