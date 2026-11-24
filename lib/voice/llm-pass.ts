import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A short-lived signed pass that lets Deepgram's Voice Agent call Friday's own thinking endpoint (/api/voice/llm) for
 * one conversation, so the OpenAI key stays on this server. Issued only to the signed-in, allowed user (with the
 * Deepgram token) and checked on every call: an expiry and an HMAC over it, keyed by a server secret.
 */

const secretOf = (env: Record<string, string | undefined>) => {
  // A dedicated secret if set; otherwise one derived from the OpenAI key (server-only either way).
  const base = env.VOICE_PASS_SECRET?.trim() || env.OPENAI_API_KEY?.trim();
  return base ? createHmac("sha256", "friday-voice-pass").update(base).digest() : null;
};

const sign = (payload: string, secret: Buffer) => createHmac("sha256", secret).update(payload).digest("base64url");

/** A pass valid for `ttlSeconds` (a conversation can last up to 2 hours). */
export function issuePass(env: Record<string, string | undefined>, ttlSeconds = 2 * 60 * 60): string | null {
  const secret = secretOf(env);
  if (!secret) return null;
  const payload = String(Math.floor(Date.now() / 1000) + ttlSeconds);
  return `${payload}.${sign(payload, secret)}`;
}

/** Whether `pass` was issued here and hasn't expired. */
export function checkPass(env: Record<string, string | undefined>, pass: string | null | undefined): boolean {
  const secret = secretOf(env);
  if (!secret || !pass) return false;
  const [payload, mac] = pass.split(".");
  if (!payload || !mac || !/^\d+$/.test(payload) || Number(payload) < Date.now() / 1000) return false;
  const want = Buffer.from(sign(payload, secret));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}
