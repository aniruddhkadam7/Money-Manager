import { useSyncExternalStore } from "react";
import { appStorage } from "@/lib/cloud/sync";
import { KOTAK_NEO_RATES, type BrokerRates } from "@/lib/trading/charges";

/** Your Kotak Neo charges, when they differ from the published ones (see KOTAK_NEO_RATES). Synced. */
const KEY = "money-manager:v1:kotak-rates";
const listeners = new Set<() => void>();
let cached: { raw: string | null; value: BrokerRates } | null = null;

const ok = (n: unknown, max: number) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= max;

function read(): BrokerRates {
  const raw = typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
  if (cached?.raw === raw) return cached.value;
  let value = KOTAK_NEO_RATES;
  try {
    const p = raw ? JSON.parse(raw) : null;
    if (p && ok(p.deliveryRate, 0.05) && ok(p.intradayRate, 0.05) && ok(p.intradayCapMinor, 1_000_00) && ok(p.dpRate, 0.05) && ok(p.dpMinMinor, 1_000_00)) value = p;
  } catch {
    // Unreadable: the published rates.
  }
  cached = { raw, value };
  return value;
}

export function setKotakRates(rates: BrokerRates | null) {
  if (rates) appStorage.setItem(KEY, JSON.stringify(rates));
  else appStorage.removeItem(KEY);
  for (const l of listeners) l();
}

export function useKotakRates(): BrokerRates {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => KOTAK_NEO_RATES,
  );
}
