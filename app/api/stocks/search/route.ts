import { cacheFor, search } from "@/lib/stocks/service";

export const dynamic = "force-dynamic";

/** GET /api/stocks/search?q=reliance — shares matching the words, Indian listings first. */
export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 60);
  if (q.length < 2) return Response.json({ hits: [] });
  try {
    return Response.json({ hits: await search(q) }, { headers: { "cache-control": cacheFor(86_400) } });
  } catch {
    return Response.json({ error: "Search isn't working right now" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
