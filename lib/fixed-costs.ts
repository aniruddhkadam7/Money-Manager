import { useSyncExternalStore } from "react";
import { appStorage } from "@/lib/cloud/sync";
import { newId } from "@/lib/domain/id";

/**
 * Your fixed costs, as you list them (rent, insurance, school fees…): what Money health's "Fixed costs" counts,
 * alongside your loan EMIs. Nothing is guessed. Synced.
 */
export type FixedCostRepeat = "monthly" | "quarterly" | "yearly";

export interface FixedCost {
  id: string;
  name: string;
  /** What you pay each time, in paise. */
  amountMinor: number;
  repeat: FixedCostRepeat;
  /** The repeating payment it was added from (a suggestion), so it isn't suggested again. */
  fromKey?: string;
}

export const FIXED_REPEAT_LABEL: Record<FixedCostRepeat, string> = { monthly: "every month", quarterly: "every 3 months", yearly: "every year" };
const PER_YEAR: Record<FixedCostRepeat, number> = { monthly: 12, quarterly: 4, yearly: 1 };

/** What it comes to in a month. */
export const monthlyOf = (c: Pick<FixedCost, "amountMinor" | "repeat">) => Math.round((c.amountMinor * PER_YEAR[c.repeat]) / 12);

const KEY = "money-manager:v1:fixed-costs";
const listeners = new Set<() => void>();
let cached: { raw: string | null; list: readonly FixedCost[] } | null = null;
const EMPTY: readonly FixedCost[] = [];

function read(): readonly FixedCost[] {
  const raw = typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
  if (cached?.raw === raw) return cached.list;
  let list: readonly FixedCost[] = EMPTY;
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      list = parsed.filter(
        (c): c is FixedCost =>
          !!c && typeof c.id === "string" && typeof c.name === "string" && Number.isInteger(c.amountMinor) && c.amountMinor > 0 && c.repeat in PER_YEAR && (c.fromKey === undefined || typeof c.fromKey === "string"),
      );
    }
  } catch {
    // Unreadable: no fixed costs listed.
  }
  cached = { raw, list };
  return list;
}

function save(list: readonly FixedCost[]) {
  appStorage.setItem(KEY, JSON.stringify(list));
  for (const l of listeners) l();
}

export function addFixedCost(cost: Omit<FixedCost, "id">) {
  save([...read(), { ...cost, id: newId() }]);
}

export function updateFixedCost(id: string, change: Omit<FixedCost, "id">) {
  save(read().map((c) => (c.id === id ? { ...c, ...change, id } : c)));
}

export function removeFixedCost(id: string) {
  save(read().filter((c) => c.id !== id));
}

/** Repeating payments you said aren't fixed costs: not suggested again. Synced. */
const HIDDEN_KEY = "money-manager:v1:fixed-costs-hidden";
let hiddenCache: { raw: string | null; keys: ReadonlySet<string> } | null = null;
const NONE: ReadonlySet<string> = new Set();

function readHidden(): ReadonlySet<string> {
  const raw = typeof window === "undefined" ? null : window.localStorage.getItem(HIDDEN_KEY);
  if (hiddenCache?.raw === raw) return hiddenCache.keys;
  let keys: ReadonlySet<string> = NONE;
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) keys = new Set(parsed.filter((k): k is string => typeof k === "string"));
  } catch {
    // Unreadable: suggest everything.
  }
  hiddenCache = { raw, keys };
  return keys;
}

export function hideFixedSuggestion(key: string) {
  appStorage.setItem(HIDDEN_KEY, JSON.stringify([...new Set([...readHidden(), key])]));
  for (const l of listeners) l();
}

export function useHiddenFixedSuggestions(): ReadonlySet<string> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    readHidden,
    () => NONE,
  );
}

export function useFixedCosts(): readonly FixedCost[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => EMPTY,
  );
}
