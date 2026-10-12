import { cacheFor, getQuotes, PRICE_TTL_S, SYMBOL_RE } from "@/lib/market/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/market/quotes?symbols=RELIANCE.NS,MF:122639 — the watchlist: price, returns and trend for each. */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("symbols") ?? "";
  // Sorted, so the same list in any order is one cached answer.
  const symbols = [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => SYMBOL_RE.test(s)))].sort().slice(0, 40);
  if (!symbols.length) return Response.json({ error: "No symbols" }, { status: 400 });

  const body = await getQuotes(symbols);
  const ok = body.quotes.length > 0;
  return Response.json(body, { status: ok ? 200 : 502, headers: { "cache-control": ok ? cacheFor(PRICE_TTL_S) : "no-store" } });
}
