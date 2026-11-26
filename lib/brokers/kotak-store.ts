import { useSyncExternalStore } from "react";
import { appStorage } from "@/lib/cloud/sync";

/**
 * Your Kotak Neo balance as each sync found it: the account it's shown as (an account named "Kotak Neo"), and
 * Kotak's figure for each day you synced. Like a bank statement's closing balance, it sets that account's
 * balance on the day (see useStatementGaps). Synced.
 */
export interface KotakFundsRecord {
  accountId: string;
  /** Kotak's "available to trade" figure for each day synced, in paise. */
  byDate: Record<string, number>;
  /** When the latest sync ran (ISO time). */
  at: string;
}

const KEY = "money-manager:v1:kotak-funds";
const listeners = new Set<() => void>();
let cached: { raw: string | null; value: KotakFundsRecord | null } | null = null;

function read(): KotakFundsRecord | null {
  const raw = typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
  if (cached?.raw === raw) return cached.value;
  let value: KotakFundsRecord | null = null;
  try {
    const p = raw ? JSON.parse(raw) : null;
    if (p && typeof p.accountId === "string" && p.byDate && typeof p.byDate === "object" && typeof p.at === "string") {
      const byDate = Object.fromEntries(Object.entries(p.byDate).filter(([d, v]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isInteger(v))) as Record<string, number>;
      value = { accountId: p.accountId, byDate, at: p.at };
    }
  } catch {
    // Unreadable: as if never synced.
  }
  cached = { raw, value };
  return value;
}

/** Records Kotak's balance for the day of a sync, shown as `accountId`. */
export function recordKotakFunds(accountId: string, date: string, availableMinor: number) {
  const prev = read();
  const byDate = prev?.accountId === accountId ? { ...prev.byDate } : {};
  byDate[date] = availableMinor;
  appStorage.setItem(KEY, JSON.stringify({ accountId, byDate, at: new Date().toISOString() }));
  for (const l of listeners) l();
}

/** The latest sync or refresh, for the Invest page: the day it's for, when it ran, and what Kotak said. */
export interface KotakPositionsRecord {
  date: string;
  at: string;
  positions: import("./kotak-neo").KotakPosition[];
  trades?: import("./kotak-neo").KotakTrade[];
  holdings?: import("./kotak-neo").KotakHolding[];
  funds?: import("./kotak-neo").KotakFunds | null;
}

const POS_KEY = "money-manager:v1:kotak-positions";
let posCached: { raw: string | null; value: KotakPositionsRecord | null } | null = null;

function readPositions(): KotakPositionsRecord | null {
  const raw = typeof window === "undefined" ? null : window.localStorage.getItem(POS_KEY);
  if (posCached?.raw === raw) return posCached.value;
  let value: KotakPositionsRecord | null = null;
  try {
    const p = raw ? JSON.parse(raw) : null;
    if (p && typeof p.date === "string" && typeof p.at === "string" && Array.isArray(p.positions)) value = p;
  } catch {
    // Unreadable: none shown.
  }
  posCached = { raw, value };
  return value;
}

export function recordKotakPositions(date: string, data: Omit<KotakPositionsRecord, "date" | "at">) {
  appStorage.setItem(POS_KEY, JSON.stringify({ date, at: new Date().toISOString(), ...data }));
  for (const l of listeners) l();
}

export function useKotakPositions(): KotakPositionsRecord | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    readPositions,
    () => null,
  );
}

export function useKotakFunds(): KotakFundsRecord | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => null,
  );
}
