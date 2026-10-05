import { aiRequestSchema } from "./ai-contract";
import { classifyBatch, createClient } from "./ai-server";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

const MAX_BODY_BYTES = 200_000;

/** Browsers always send Origin on cross-site POSTs; if it's there it must be this site, so another page can't spend the API key. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function handleAvailability(env: Record<string, string | undefined> = process.env) {
  const c = createClient(env);
  return json({ available: !!c, model: c?.model ?? null });
}

/** Never logs statement content: errors are reported by kind only. */
export async function handleClassify(req: Request, env: Record<string, string | undefined> = process.env) {
  if (!sameOrigin(req)) return json({ error: "forbidden", message: "Cross-site requests are not allowed." }, 403);

  const configured = createClient(env);
  if (!configured) return json({ error: "not_configured", message: "AI classification isn't set up (no OPENAI_API_KEY on the server)." }, 503);

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: "too_large", message: "Request too large." }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "bad_request", message: "Request wasn't valid JSON." }, 400);
  }
  const parsed = aiRequestSchema.safeParse(body);
  if (!parsed.success) return json({ error: "bad_request", message: "Request didn't match the expected format." }, 400);

  try {
    return json(await classifyBatch(parsed.data, configured));
  } catch (err) {
    const status = typeof (err as { status?: unknown })?.status === "number" ? ((err as { status: number }).status) : 0;
    if (status === 401 || status === 403) return json({ error: "auth", message: "The OpenAI key was rejected." }, 502);
    if (status === 429) return json({ error: "rate_limited", message: "OpenAI is rate limiting requests." }, 503);
    return json({ error: "upstream", message: "The AI service couldn't classify this batch." }, 502);
  }
}
