import { sameOrigin, signedInAllowed } from "@/lib/statements/ai-route";
import { issuePass } from "./llm-pass";

/**
 * Friday's voice, through Deepgram: what you say becomes text (listen), and Friday's answer becomes speech (speak).
 * The key stays on the server; only you (signed in, allowed) and only from this site may use it. Nothing is logged.
 */

const DEEPGRAM = "https://api.deepgram.com/v1";
// About two minutes of speech from a phone; more than any question needs.
const MAX_AUDIO = 8 * 1024 * 1024;
// Deepgram reads up to 2,000 characters at a time.
const MAX_SPEAK = 2000;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
// The Member key (DEEPGRAM_AGENT_KEY) first: it does everything (speech to text, voice, the live assistant);
// DEEPGRAM_API_KEY only when that isn't set.
const keyOf = (env: Record<string, string | undefined>) => env.DEEPGRAM_AGENT_KEY?.trim() || env.DEEPGRAM_API_KEY?.trim() || null;

/** Whether voice can be used (the Deepgram key is set on the server). */
export function voiceAvailability(env: Record<string, string | undefined> = process.env) {
  return json({ available: !!keyOf(env) });
}

async function guard(req: Request, env: Record<string, string | undefined>): Promise<Response | string> {
  if (!sameOrigin(req)) return json({ error: "forbidden", message: "Cross-site requests are not allowed." }, 403);
  if (!(await signedInAllowed(req, env))) return json({ error: "unauthorized", message: "Sign in to talk to Friday." }, 401);
  const key = keyOf(env);
  if (!key) return json({ error: "not_configured", message: "Voice isn't set up (no DEEPGRAM_API_KEY on the server)." }, 503);
  return key;
}

const failure = (status: number) =>
  status === 401 || status === 403 ? "The Deepgram key was rejected." : status === 402 ? "The Deepgram account is out of credit." : status === 429 ? "Voice is busy. Try again in a minute." : "Couldn't do that just now. Try again.";

/** Audio in (the recording, as the browser made it), text out: { text }. */
export async function handleListen(req: Request, env: Record<string, string | undefined> = process.env) {
  const key = await guard(req, env);
  if (typeof key !== "string") return key;
  const audio = await req.arrayBuffer();
  if (audio.byteLength === 0) return json({ text: "" });
  if (audio.byteLength > MAX_AUDIO) return json({ error: "too_large", message: "That recording is too long." }, 413);
  // Indian English by default, with numbers written as digits ("five thousand" -> 5000).
  const lang = new URL(req.url).searchParams.get("language") || "en-IN";
  const params = new URLSearchParams({ model: "nova-3", smart_format: "true", numerals: "true", punctuate: "true", language: lang });
  try {
    const res = await fetch(`${DEEPGRAM}/listen?${params}`, {
      method: "POST",
      headers: { authorization: `Token ${key}`, "content-type": req.headers.get("content-type") || "application/octet-stream" },
      body: audio,
    });
    if (!res.ok) {
      console.error("voice: listen failed", res.status);
      return json({ error: "upstream", message: failure(res.status) }, 502);
    }
    const data = (await res.json()) as { results?: { channels?: { alternatives?: { transcript?: string }[] }[] } };
    return json({ text: data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "" });
  } catch (err) {
    console.error("voice: listen failed", (err as Error)?.name);
    return json({ error: "upstream", message: failure(0) }, 502);
  }
}

/** Text in ({ text }), speech out (MP3). */
export async function handleSpeak(req: Request, env: Record<string, string | undefined> = process.env) {
  const key = await guard(req, env);
  if (typeof key !== "string") return key;
  let text = "";
  try {
    const body = (await req.json()) as { text?: unknown };
    text = typeof body.text === "string" ? body.text.trim() : "";
  } catch {
    return json({ error: "bad_request", message: "Request wasn't valid JSON." }, 400);
  }
  if (!text) return json({ error: "bad_request", message: "Nothing to say." }, 400);
  if (text.length > MAX_SPEAK) return json({ error: "too_large", message: "That's too long to read out in one go." }, 413);
  const voice = env.DEEPGRAM_VOICE?.trim() || "aura-2-thalia-en";
  try {
    const res = await fetch(`${DEEPGRAM}/speak?model=${encodeURIComponent(voice)}&encoding=mp3`, {
      method: "POST",
      headers: { authorization: `Token ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok || !res.body) {
      console.error("voice: speak failed", res.status);
      return json({ error: "upstream", message: failure(res.status) }, 502);
    }
    return new Response(res.body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
  } catch (err) {
    console.error("voice: speak failed", (err as Error)?.name);
    return json({ error: "upstream", message: failure(0) }, 502);
  }
}

/**
 * A short-lived Deepgram token for the live voice assistant (the Voice Agent), so the browser can open its own
 * connection without ever holding the key. Minting needs a key with the Member role or higher: DEEPGRAM_AGENT_KEY if
 * set, else DEEPGRAM_API_KEY. The token only has to be valid when the connection opens.
 */
export async function handleAgentToken(req: Request, env: Record<string, string | undefined> = process.env) {
  const fallback = await guard(req, env);
  if (typeof fallback !== "string") return fallback;
  const key = env.DEEPGRAM_AGENT_KEY?.trim() || fallback;
  try {
    const res = await fetch(`${DEEPGRAM}/auth/grant`, {
      method: "POST",
      headers: { authorization: `Token ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ ttl_seconds: 60 }),
    });
    if (!res.ok) {
      console.error("voice: agent token failed", res.status);
      return json(
        {
          error: res.status === 403 ? "key_role" : "upstream",
          message:
            res.status === 403
              ? "The live assistant needs a Deepgram key with the Member role (set it as DEEPGRAM_AGENT_KEY)."
              : failure(res.status),
        },
        res.status === 403 ? 503 : 502,
      );
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return json({ error: "upstream", message: failure(0) }, 502);
    // Friday's own thinking (your model, on this server): only where Deepgram can reach it, i.e. not this computer.
    const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
    const reachable = !!host && !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(host);
    const pass = reachable ? issuePass(env) : null;
    return json({
      token: data.access_token,
      expiresIn: data.expires_in ?? 60,
      ...(pass ? { llm: { url: `https://${host}/api/voice/llm`, pass } } : {}),
    });
  } catch (err) {
    console.error("voice: agent token failed", (err as Error)?.name);
    return json({ error: "upstream", message: failure(0) }, 502);
  }
}
