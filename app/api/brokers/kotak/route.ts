import { KotakError, kotakConfig, kotakLogin, kotakRead, type KotakConfig } from "@/lib/brokers/kotak-neo";
import { openSession, sealSession } from "@/lib/brokers/kotak-session";
import { totpCode } from "@/lib/brokers/totp";
import { sameOrigin, signedInAllowed } from "@/lib/statements/ai-route";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function allowed(req: Request): Promise<Response | KotakConfig> {
  const env = process.env;
  if (!sameOrigin(req)) return json({ error: "forbidden", message: "Cross-site requests are not allowed." }, 403);
  if (!(await signedInAllowed(req, env))) return json({ error: "unauthorized", message: "Sign in first." }, 401);
  const cfg = kotakConfig(env);
  if (!cfg) return json({ error: "not_configured", message: "Kotak Neo isn't set up on the server (KOTAK_NEO_TOKEN, KOTAK_NEO_MOBILE, KOTAK_NEO_UCC)." }, 503);
  return cfg;
}

/** Whether the server logs in by itself (no TOTP to type). */
export async function GET(req: Request) {
  const cfg = await allowed(req);
  if (cfg instanceof Response) return cfg;
  return json({ auto: !!cfg.auto });
}

/**
 * Reads your Kotak Neo funds, trades, holdings and positions (read only). The day's session comes from:
 * - { session }: the sealed one handed back earlier today (a refresh), or
 * - { totp, mpin }: logging in with what you type (neither is stored or logged), or
 * - { auto: true }: logging in by itself, when the TOTP secret and MPIN are set on the server.
 * An ended session is replaced by logging in by itself when it can. The session goes back sealed, for refreshes.
 */
export async function POST(req: Request) {
  const env = process.env;
  const cfg = await allowed(req);
  if (cfg instanceof Response) return cfg;

  const body = (await req.json().catch(() => null)) as { totp?: unknown; mpin?: unknown; today?: unknown; session?: unknown; auto?: unknown } | null;
  const today = typeof body?.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);
  const autoLogin = () => (cfg.auto ? kotakLogin(cfg, totpCode(cfg.auto.totpSecret), cfg.auto.mpin) : null);

  try {
    let session = body?.session !== undefined ? openSession(env, body.session) : null;
    let fresh = false;
    if (!session) {
      if (body?.session !== undefined || body?.auto) {
        // A refresh whose session has ended, or a sync that logs in by itself.
        const s = await autoLogin();
        if (!s) return json({ error: "expired", message: "The Kotak session has ended. Sync with a TOTP again." }, 401);
        session = s;
      } else {
        const totp = String(body?.totp ?? "").replace(/\s/g, "");
        const mpin = String(body?.mpin ?? "").replace(/\s/g, "");
        if (!/^\d{6}$/.test(totp)) return json({ error: "bad_totp", message: "Enter the 6-digit TOTP from your authenticator app." }, 400);
        if (!/^\d{4,6}$/.test(mpin)) return json({ error: "bad_mpin", message: "Enter your Kotak Neo MPIN." }, 400);
        session = await kotakLogin(cfg, totp, mpin);
      }
      fresh = true;
    }
    try {
      const data = await kotakRead(session, today);
      return json({ ...data, ...(fresh ? { session: sealSession(env, session) } : {}) });
    } catch (err) {
      // Kotak ended the session early (a login elsewhere, say): log in again by itself once, when it can.
      if (!fresh && err instanceof KotakError && err.status === 401) {
        const s = await autoLogin();
        if (s) return json({ ...(await kotakRead(s, today)), session: sealSession(env, s) });
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof KotakError) return json({ error: err.status === 401 ? "expired" : "kotak", message: err.message }, err.status);
    console.error("kotak neo: sync failed", (err as Error)?.name);
    return json({ error: "failed", message: "Couldn't read from Kotak Neo just now." }, 502);
  }
}
