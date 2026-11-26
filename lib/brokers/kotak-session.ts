import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import type { KotakSession } from "./kotak-neo";

/**
 * The day's Kotak session, sealed (AES-256-GCM, keyed by a server secret) so the browser can keep it and the app can
 * refresh your balance all day without a TOTP, while only this server can read it. It expires at the end of the day
 * (India time), as Kotak's session does. Server side only.
 */

const keyOf = (env: Record<string, string | undefined>) => {
  // A dedicated secret if set; otherwise one derived from the Kotak token (server-only either way).
  const base = env.KOTAK_SESSION_SECRET?.trim() || env.KOTAK_NEO_TOKEN?.trim();
  return base ? createHmac("sha256", "kotak-session-seal").update(base).digest() : null;
};

/** The end of today in India (Kotak sessions don't outlive the trading day). */
function endOfIndianDay(now = Date.now()): number {
  const ist = new Date(now + 5.5 * 3600_000);
  ist.setUTCHours(23, 59, 59, 0);
  return ist.getTime() - 5.5 * 3600_000;
}

export function sealSession(env: Record<string, string | undefined>, s: KotakSession, now = Date.now()): string | null {
  const key = keyOf(env);
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ ...s, exp: endOfIndianDay(now) }), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

/** The session, or null if it isn't one of ours, was tampered with, or has expired. */
export function openSession(env: Record<string, string | undefined>, sealed: unknown, now = Date.now()): KotakSession | null {
  const key = keyOf(env);
  if (!key || typeof sealed !== "string") return null;
  const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p ?? "", "base64url"));
  if (!iv?.length || !tag?.length || !body?.length) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const s = JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8")) as KotakSession & { exp: number };
    if (typeof s.exp !== "number" || s.exp < now || typeof s.sid !== "string" || typeof s.token !== "string" || typeof s.base !== "string") return null;
    return { sid: s.sid, token: s.token, base: s.base };
  } catch {
    return null;
  }
}
