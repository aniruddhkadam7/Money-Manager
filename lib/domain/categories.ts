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
  { id: "alcohol", name: "Alcohol", color: "#b91c1c", icon: "custom", isDefault: true },
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

const CUSTOM_COLORS = ["#f43f5e", "#06b6d4", "#84cc16", "#d946ef", "#f59e0b"];

export function colorForCustomCategory(index: number): string {
  return CUSTOM_COLORS[index % CUSTOM_COLORS.length];
}
