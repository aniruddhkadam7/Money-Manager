import { cacheFor, getRatios, RATIOS_TTL_S } from "@/lib/market/service";

export const dynamic = "force-dynamic";

/** NSE listings only. */
const STOCK_RE = /^[A-Z0-9&\-]{1,20}\.NS$/;

/** GET /api/market/company?symbol=TCS.NS — a company's key ratios (ROE, margins, debt, growth) from Yahoo. */
export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol") ?? "";
  if (!STOCK_RE.test(symbol)) return Response.json({ error: "Bad symbol" }, { status: 400 });
  try {
    return Response.json(await getRatios(symbol), { headers: { "cache-control": cacheFor(RATIOS_TTL_S) } });
  } catch {
    return Response.json({ error: "Couldn't load this company's ratios" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
