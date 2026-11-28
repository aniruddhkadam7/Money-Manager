import { kotakTokenFor } from "@/lib/brokers/kotak-access";
import { kotakPrices } from "@/lib/brokers/kotak-market";
import { cacheFor, getLtp, LTP_TTL_S, SYMBOL_RE } from "@/lib/stocks/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/stocks/ltp?symbols=RELIANCE.NS,INFY.NS — last traded prices, fresh to within seconds. For you (signed in),
 * NSE shares come from Kotak Neo; anything Kotak doesn't give (an index like ^NSEI, a BSE-only share, Kotak not
 * answering) comes from Yahoo.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("symbols") ?? "";
  const symbols = [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => SYMBOL_RE.test(s)))].sort().slice(0, 40);
  if (!symbols.length) return Response.json({ error: "No symbols" }, { status: 400 });

  const prices: Record<string, { price: number; prevClose: number | null; time: number }> = {};
  const token = await kotakTokenFor(request);
  const nse = symbols.filter((s) => s.endsWith(".NS"));
  if (token && nse.length) {
    try {
      const got = await kotakPrices(token, nse.map((s) => s.slice(0, -3)));
      const now = Math.floor(Date.now() / 1000);
      for (const s of nse) {
        const p = got[s.slice(0, -3).toUpperCase()];
        if (p) prices[s] = { ...p, time: now };
      }
    } catch {
      // Kotak didn't answer: Yahoo below.
    }
  }
  const rest = symbols.filter((s) => !prices[s]);
  const yahoo = rest.length ? await getLtp(rest) : { prices: {}, fetchedAt: Date.now() };
  const body = { prices: { ...yahoo.prices, ...prices }, fetchedAt: Date.now() };
  const ok = Object.keys(body.prices).length > 0;
  // Your prices (from your Kotak account) aren't for shared caches.
  return Response.json(body, { status: ok ? 200 : 502, headers: { "cache-control": !ok ? "no-store" : token ? "private, no-store" : cacheFor(LTP_TTL_S) } });
}
