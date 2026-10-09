export const dynamic = "force-dynamic";

/**
 * Called daily by a Vercel cron (vercel.json). Supabase pauses free projects after a week without
 * activity; one tiny database query a day keeps it awake even when the app isn't opened.
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return Response.json({ ok: false, reason: "not_configured" }, { status: 503 });
  const res = await fetch(`${url}/rest/v1/rpc/ping`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: "{}",
    cache: "no-store",
  });
  return Response.json({ ok: res.ok }, { status: res.ok ? 200 : 502, headers: { "cache-control": "no-store" } });
}
