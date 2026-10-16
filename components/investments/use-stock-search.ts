"use client";

import { useEffect, useState } from "react";
import type { SearchHit } from "@/lib/stocks/yahoo";

/** Search as you type, a moment after the typing stops. */
export function useStockSearch(q: string) {
  const query = q.trim().toLowerCase();
  const [state, setState] = useState<{ q: string; hits: SearchHit[]; error: boolean }>({ q: "", hits: [], error: false });

  useEffect(() => {
    if (query.length < 2) return;
    let alive = true;
    const timer = setTimeout(() => {
      fetch(`/api/stocks/search?q=${encodeURIComponent(query)}`)
        .then(async (res) => {
          const body = (await res.json()) as { hits?: SearchHit[] };
          if (!res.ok || !body.hits) throw new Error("Search failed");
          if (alive) setState({ q: query, hits: body.hits, error: false });
        })
        .catch(() => alive && setState({ q: query, hits: [], error: true }));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  const current = state.q === query;
  return { hits: current ? state.hits : [], searching: query.length >= 2 && !current, error: current && state.error };
}
