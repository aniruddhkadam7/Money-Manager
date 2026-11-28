import { kotakTokenFor } from "@/lib/brokers/kotak-access";
import { kotakDailyCloses } from "@/lib/brokers/kotak-market";
import { cacheFor, getDailyCloses, SYMBOL_RE } from "@/lib/stocks/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/stocks/history?symbols=ITC.NS,INFY.NS&from=2026-11-01 — each share's daily closes since that date. For you
 * (signed in), NSE shares come from Kotak Neo (its last 180 days); earlier days and anything else, from Yahoo.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbols = [...new Set((url.searchParams.get("symbols") ?? "").split(",").map((s) => s.trim()).filter((s) => SYMBOL_RE.test(s)))].sort().slice(0, 40);
  const from = url.searchParams.get("from") ?? "";
  if (!symbols.length || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return Response.json({ error: "Need symbols and a from date" }, { status: 400 });

  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const token = await kotakTokenFor(request);
  const closes: Record<string, Record<string, number>> = {};
  if (token) {
    await Promise.all(
      symbols
        .filter((s) => s.endsWith(".NS"))
        .map(async (s) => {
          try {
            const days = await kotakDailyCloses(token, s.slice(0, -3), from, today);
            if (Object.keys(days).length) closes[s] = days;
          } catch {
            // Kotak didn't answer: Yahoo below.
          }
        }),
    );
  }
  // Yahoo for anything Kotak didn't give, and for days before Kotak's 180.
  const yahoo = await getDailyCloses(symbols, from);
  for (const s of symbols) if (yahoo[s]) closes[s] = { ...yahoo[s], ...(closes[s] ?? {}) };
  const ok = Object.keys(closes).length > 0;
  return Response.json({ closes }, { status: ok ? 200 : 502, headers: { "cache-control": !ok ? "no-store" : token ? "private, no-store" : cacheFor(3600) } });
}
