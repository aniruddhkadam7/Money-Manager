"use client";

import { useEffect, useState } from "react";
import type { LtpResponse } from "@/lib/stocks/yahoo";

/** Yahoo's symbol for an Indian share: RELIANCE on NSE is RELIANCE.NS, on BSE RELIANCE.BO. */
export const yahooSymbol = (symbol: string, exchange: "NSE" | "BSE" = "NSE") => `${symbol.toUpperCase()}.${exchange === "BSE" ? "BO" : "NS"}`;

/**
 * Last traded prices for these stock symbols (in paise), refreshed every `everyMs` while the page is on screen.
 * Prices from Yahoo can lag the exchange by a little; the time of each is returned with it.
 */
export function useLtp(symbols: string[], everyMs = 15_000) {
  const key = [...new Set(symbols.map((s) => yahooSymbol(s)))].sort().join(",");
  const [state, setState] = useState<{ key: string; data: LtpResponse | null; error: boolean }>({ key: "", data: null, error: false });

  useEffect(() => {
    if (!key) return;
    let alive = true;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      fetch(`/api/stocks/ltp?symbols=${encodeURIComponent(key)}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`Status ${res.status}`);
          const data = (await res.json()) as LtpResponse;
          if (alive) setState({ key, data, error: false });
        })
        .catch(() => alive && setState((s) => (s.key === key ? { ...s, error: true } : { key, data: null, error: true })));
    };
    load();
    const timer = setInterval(load, everyMs);
    document.addEventListener("visibilitychange", load);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [key, everyMs]);

  const data = state.key === key ? state.data : null;
  /** A symbol's last price in paise, or null when it isn't known. */
  const ltp = (symbol: string): number | null => {
    const p = data?.prices[yahooSymbol(symbol)];
    return p ? Math.round(p.price * 100) : null;
  };
  return { ltp, at: data?.fetchedAt ?? null, error: state.key === key && state.error };
}
