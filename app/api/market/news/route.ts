import { cacheFor, getNews, NEWS_TTL_S } from "@/lib/market/service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/market/news — important finance and economy news, grouped across outlets. The same for everyone. */
export async function GET() {
  try {
    return Response.json(await getNews(), { headers: { "cache-control": cacheFor(NEWS_TTL_S) } });
  } catch {
    return Response.json({ error: "News isn't available right now" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
