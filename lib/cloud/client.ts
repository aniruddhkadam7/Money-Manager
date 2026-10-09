import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The browser's Supabase client. Without the two public env vars the app runs exactly as before:
 * everything stays in this browser and there is no login.
 */
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const cloudConfigured = !!(URL && ANON_KEY);

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient | null {
  if (!cloudConfigured || typeof window === "undefined") return null;
  return (client ??= createClient(URL!, ANON_KEY!));
}

/** fetch that carries the signed-in user's token, so server routes can tell who is calling. */
export const authFetch: typeof fetch = async (input, init) => {
  const token = (await supabase()?.auth.getSession())?.data.session?.access_token;
  if (!token) return fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
};
