import type { Category } from "./types";

export const DEFAULT_CATEGORIES: Category[] = [
  { id: "food", name: "Food", color: "#f97316", icon: "food", isDefault: true },
  { id: "shopping", name: "Shopping", color: "#ec4899", icon: "shopping", isDefault: true },
  { id: "transport", name: "Transport", color: "#0ea5e9", icon: "transport", isDefault: true },
  { id: "petrol", name: "Petrol", color: "#dc2626", icon: "transport", isDefault: true },
  { id: "rent", name: "Rent", color: "#8b5cf6", icon: "rent", isDefault: true },
  { id: "bills", name: "Bills", color: "#eab308", icon: "bills", isDefault: true },
  { id: "entertainment", name: "Entertainment", color: "#14b8a6", icon: "entertainment", isDefault: true },
  { id: "health", name: "Health", color: "#22c55e", icon: "health", isDefault: true },
  { id: "travel", name: "Travel", color: "#6366f1", icon: "travel", isDefault: true },
  { id: "subscriptions", name: "Subscriptions", color: "#06b6d4", icon: "custom", isDefault: true },
  { id: "emi", name: "EMI", color: "#0891b2", icon: "loan", isDefault: true },
  { id: "grocery", name: "Grocery", color: "#65a30d", icon: "food", isDefault: true },
  { id: "smoking", name: "Smoking", color: "#78716c", icon: "custom", isDefault: true },
  { id: "alcohol", name: "Alcohol", color: "#be123c", icon: "alcohol", isDefault: true },
  { id: "maintenance", name: "Maintenance", color: "#0f766e", icon: "rent", isDefault: true },
  { id: "jugaad", name: "Jugaad", color: "#a16207", icon: "custom", isDefault: true },
  { id: "other", name: "Other", color: "#94a3b8", icon: "other", isDefault: true },
];

export const DEFAULT_INCOME_CATEGORIES: Category[] = [
  { id: "salary", name: "Salary", color: "#10b981", icon: "income", isDefault: true, kind: "income" },
  { id: "business", name: "Business", color: "#0ea5e9", icon: "income", isDefault: true, kind: "income" },
  { id: "interest", name: "Interest", color: "#8b5cf6", icon: "income", isDefault: true, kind: "income" },
  { id: "refund", name: "Refund", color: "#f59e0b", icon: "income", isDefault: true, kind: "income" },
  { id: "reimbursement", name: "Reimbursement", color: "#64748b", icon: "income", isDefault: true, kind: "income" },
  { id: "gift", name: "Gift", color: "#ec4899", icon: "income", isDefault: true, kind: "income" },
  { id: "other-income", name: "Other income", color: "#94a3b8", icon: "income", isDefault: true, kind: "income" },
];

export const FALLBACK_CATEGORY: Category = {
  id: "other",
  name: "Other",
  color: "#94a3b8",
  icon: "other",
  isDefault: true,
};

/** Puts each subcategory right after its parent; everything else keeps its order. Orphans stay at the end. */
export function orderWithChildren(list: Category[]): Category[] {
  const ids = new Set(list.map((c) => c.id));
  const top = list.filter((c) => !c.parentId || !ids.has(c.parentId));
  return top.flatMap((c) => [c, ...list.filter((x) => x.parentId === c.id)]);
}

/** "Health › Hair care" for a subcategory, the plain name otherwise. */
export function categoryLabel(c: Category, list: Category[]): string {
  const parent = c.parentId ? list.find((x) => x.id === c.parentId) : undefined;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

/** The category and all of its subcategories. */
export function familyIds(id: string, list: Category[]): string[] {
  return [id, ...list.filter((c) => c.parentId === id).map((c) => c.id)];
}

export type RolledRow<T extends { categoryId: string; amountMinor: number }> = T & { children: T[] };

/**
 * Folds subcategory amounts into their parent: one row per main category (its own spend plus its
 * subcategories'), each carrying its subcategory rows. Biggest first at both levels.
 */
export function rollUpByParent<T extends { categoryId: string; amountMinor: number }>(rows: T[], list: Category[]): RolledRow<T>[] {
  const parentOf = (id: string) => {
    const p = list.find((c) => c.id === id)?.parentId;
    return p && list.some((c) => c.id === p) ? p : undefined;
  };
  const bigFirst = (a: T, b: T) => b.amountMinor - a.amountMinor;
  const children = new Map<string, T[]>();
  for (const r of rows) {
    const p = parentOf(r.categoryId);
    if (p) children.set(p, [...(children.get(p) ?? []), r]);
  }
  const tops = new Map<string, RolledRow<T>>();
  for (const r of rows) {
    if (parentOf(r.categoryId)) continue;
    tops.set(r.categoryId, { ...r, children: (children.get(r.categoryId) ?? []).sort(bigFirst) });
  }
  for (const [p, kids] of children) {
    const sum = kids.reduce((t, k) => t + k.amountMinor, 0);
    const own = tops.get(p);
    if (own) own.amountMinor += sum;
    else tops.set(p, { ...kids[0], categoryId: p, amountMinor: sum, children: kids.sort(bigFirst) });
  }
  return [...tops.values()].sort(bigFirst);
}

const CUSTOM_COLORS = ["#f43f5e", "#06b6d4", "#84cc16", "#d946ef", "#f59e0b"];

export function colorForCustomCategory(index: number): string {
  return CUSTOM_COLORS[index % CUSTOM_COLORS.length];
}
