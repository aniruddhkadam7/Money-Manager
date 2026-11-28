import { signedInAllowed } from "@/lib/statements/ai-route";

/**
 * The Kotak Trade API token, for a request from you (signed in): price lookups use your token, so they're only
 * made for you. A confirmed sign-in is remembered for 10 minutes, so prices every few seconds don't re-check it.
 */
const confirmed = new Map<string, number>();

export async function kotakTokenFor(req: Request, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const token = env.KOTAK_NEO_TOKEN?.trim();
  if (!token) return null;
  const auth = req.headers.get("authorization") ?? "";
  const until = confirmed.get(auth);
  if (until && until > Date.now()) return token;
  if (!(await signedInAllowed(req, env))) return null;
  confirmed.set(auth, Date.now() + 10 * 60_000);
  if (confirmed.size > 50) confirmed.delete(confirmed.keys().next().value!);
  return token;
}
