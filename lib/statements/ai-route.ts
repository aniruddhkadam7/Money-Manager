import { createClient as createSupabaseClient } from "@supabase/supabase-js";
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

/**
 * With Supabase set up, only a signed-in user whose email is in ALLOWED_EMAIL may spend the API key.
 * Without it the app is running locally with no login; a Vercel deployment always needs one.
 */
async function signedInAllowed(req: Request, env: Record<string, string | undefined>): Promise<boolean> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return !env.VERCEL;
  const token = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return false;
  const allowed = (env.ALLOWED_EMAIL ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) return false;
  const { data, error } = await createSupabaseClient(url, anonKey, { auth: { persistSession: false } }).auth.getUser(token);
  return !error && !!data.user?.email && allowed.includes(data.user.email.toLowerCase());
}

export function handleAvailability(env: Record<string, string | undefined> = process.env) {
  const c = createClient(env);
  return json({ available: !!c, model: c?.model ?? null });
}

/** Never logs statement content: errors are reported by kind only. */
export async function handleClassify(req: Request, env: Record<string, string | undefined> = process.env) {
  if (!sameOrigin(req)) return json({ error: "forbidden", message: "Cross-site requests are not allowed." }, 403);
  if (!(await signedInAllowed(req, env))) return json({ error: "unauthorized", message: "Sign in to use AI classification." }, 401);

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
