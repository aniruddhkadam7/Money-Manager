import { useSyncExternalStore } from "react";
import { appStorage } from "@/lib/cloud/sync";

/** A monthly spending plan: the most to spend on a category in a month, in paise. Categories without one aren't tracked. */
export type Budgets = Record<string, number>;

/** From here a budget gets a quiet heads-up; past the whole of it, a kinder note, never an alarm. */
export const NEAR_RATIO = 0.8;

export type BudgetState = "ok" | "near" | "over";

export interface BudgetLine {
  categoryId: string;
  limitMinor: number;
  spentMinor: number;
  /** Spent over the limit; 1 is exactly on budget. */
  ratio: number;
  state: BudgetState;
}

/** Each budgeted category against what was spent on it, the most stretched first. Spending is the period report's, net of refunds. */
export function budgetLines(budgets: Budgets, spent: { categoryId: string; amountMinor: number }[]): BudgetLine[] {
  const spentBy = new Map(spent.map((s) => [s.categoryId, s.amountMinor]));
  return Object.entries(budgets)
    .filter(([, limit]) => limit > 0)
    .map(([categoryId, limitMinor]) => {
      const spentMinor = Math.max(0, spentBy.get(categoryId) ?? 0);
      const ratio = spentMinor / limitMinor;
      return { categoryId, limitMinor, spentMinor, ratio, state: ratio > 1 ? "over" : ratio >= NEAR_RATIO ? "near" : "ok" } as BudgetLine;
    })
    .sort((a, b) => b.ratio - a.ratio);
}

const KEY = "money-manager:v1:budgets";
const listeners = new Set<() => void>();
let cached: { raw: string | null; budgets: Budgets } | null = null;

function read(): Budgets {
  const raw = typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
  if (cached?.raw === raw) return cached.budgets;
  let budgets: Budgets = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") {
      budgets = Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v > 0));
    }
  } catch {
    // An unreadable plan just means no budgets yet.
  }
  cached = { raw, budgets };
  return budgets;
}

export function saveBudgets(budgets: Budgets) {
  appStorage.setItem(KEY, JSON.stringify(budgets));
  for (const l of listeners) l();
}

const EMPTY: Budgets = {};
export function useBudgets(): Budgets {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => EMPTY,
  );
}
