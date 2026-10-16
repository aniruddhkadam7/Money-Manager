import { fetchLastPrice, searchYahoo, type LtpResponse, type SearchHit } from "./yahoo";

/**
 * The server side of Investments' share lookups: a stateless go-between for Yahoo, which a browser can't
 * call itself (no CORS headers). Answers are kept briefly in this process's memory so repeated requests
 * share one call to Yahoo; nothing is stored.
 */
const store = new Map<string, { until: number; value: Promise<unknown> }>();

function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() < hit.until) return hit.value as Promise<T>;
  const value = load();
  store.set(key, { until: Date.now() + ttlMs, value });
  // A failure isn't kept: the next request tries again.
  value.catch(() => store.delete(key));
  if (store.size > 2000) store.delete(store.keys().next().value!);
  return value;
}

/** Last traded prices for open stock positions: kept only seconds, since a scalper's P&L moves tick by tick. */
export const LTP_TTL_S = 15;

export async function getLtp(symbols: string[]): Promise<LtpResponse> {
  const body: LtpResponse = { prices: {}, fetchedAt: Date.now() };
  // Six at a time, so forty positions don't fire forty requests at once.
  let next = 0;
  const worker = async () => {
    while (next < symbols.length) {
      const s = symbols[next++];
      try {
        body.prices[s] = await cached(`ltp:${s}`, LTP_TTL_S * 1000, () => fetchLastPrice(s));
      } catch {
        // Left out: the page shows it has no price.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, symbols.length) }, worker));
  return body;
}

/** NSE and BSE shares (and anything else Yahoo lists) matching the words; kept a day. */
export function search(q: string): Promise<SearchHit[]> {
  const key = q.trim().toLowerCase();
  return cached(`s:${key}`, 24 * 3600_000, () => searchYahoo(key));
}

/** Symbols as Yahoo writes them: letters, digits and ^ = . - _ &. */
export const SYMBOL_RE = /^[A-Za-z0-9^=.\-_&]{1,32}$/;

/** Cache-Control for a shared answer kept `seconds`: the CDN serves it that long, then an older copy while it refreshes. */
export const cacheFor = (seconds: number) => `public, max-age=${Math.min(seconds, 600)}, s-maxage=${seconds}, stale-while-revalidate=${seconds * 4}`;
