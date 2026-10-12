"use client";

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Period, Quote } from "@/lib/market/types";

export interface SortOption<K extends string> {
  value: K;
  label: string;
}

/** A small "Sort" dropdown for a card's header, like the one on Activity. */
export function SortSelect<K extends string>({ value, options, onChange, label }: { value: K; options: SortOption<K>[]; onChange: (v: K) => void; label: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as K)}>
      <SelectTrigger className="h-8 w-auto min-w-0 gap-1.5 rounded-full px-3 text-xs sm:h-8 sm:text-xs" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A list's sort order, remembered in this browser per list. */
export function useSort<K extends string>(id: string, options: SortOption<K>[], fallback: K): [K, (v: K) => void] {
  const key = `mm-market-sort:${id}`;
  const [value, setValue] = useState<K>(fallback);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(key) as K | null;
      if (saved && options.some((o) => o.value === saved)) setValue(saved);
    } catch {
      // Default order then.
    }
    // The options are fixed per list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const choose = (v: K) => {
    setValue(v);
    try {
      window.localStorage.setItem(key, v);
    } catch {
      // Not remembered; fine.
    }
  };
  return [value, choose];
}

export type QuoteSort = "listed" | "best" | "worst" | "name" | "priceHigh" | "priceLow";

export const QUOTE_SORTS: SortOption<QuoteSort>[] = [
  { value: "listed", label: "Usual order" },
  { value: "best", label: "Best return" },
  { value: "worst", label: "Worst return" },
  { value: "name", label: "Name A–Z" },
];
/** For lists in one currency, where comparing prices means something (a sector's stocks, say). */
export const PRICE_SORTS: SortOption<QuoteSort>[] = [
  { value: "priceHigh", label: "Highest price" },
  { value: "priceLow", label: "Lowest price" },
];

/**
 * Items in the chosen order. Ones without a quote (still loading, or unavailable) and returns that
 * can't be worked out always go last, whichever way the list runs.
 */
export function sortItems<T>(items: T[], sort: QuoteSort, period: Period, quoteOf: (item: T) => Quote | undefined, nameOf: (item: T) => string): T[] {
  if (sort === "listed") return items;
  const key = (item: T): number | string | null => {
    const q = quoteOf(item);
    if (sort === "name") return nameOf(item).toLowerCase();
    if (!q) return null;
    if (sort === "priceHigh" || sort === "priceLow") return q.price;
    return q.perf[period];
  };
  const dir = sort === "worst" || sort === "priceLow" || sort === "name" ? 1 : -1;
  return items
    .map((item, i) => ({ item, i, k: key(item) }))
    .sort((a, b) => {
      if (a.k === null || b.k === null) return a.k === b.k ? a.i - b.i : a.k === null ? 1 : -1;
      if (typeof a.k === "string" && typeof b.k === "string") return a.k.localeCompare(b.k) || a.i - b.i;
      return ((a.k as number) - (b.k as number)) * dir || a.i - b.i;
    })
    .map(({ item }) => item);
}
