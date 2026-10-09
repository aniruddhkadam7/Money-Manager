import { appStorage } from "@/lib/cloud/sync";
import {
  DEFAULT_CATEGORIES,
  colorForCustomCategory,
} from "@/lib/domain/categories";
import type {
  Category,
  Expense,
  ExpenseInput,
  ExpenseRepository,
} from "@/lib/domain/types";

const EXPENSES_KEY = "money-manager:v0:expenses";
const CUSTOM_CATEGORIES_KEY = "money-manager:v0:custom-categories";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  appStorage.setItem(key, JSON.stringify(value));
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Browser-only implementation. localStorage is touched inside methods (never
 * at import time), so importing this module during SSR is safe.
 * Default categories live in code; only custom ones are persisted.
 */
export class LocalStorageExpenseRepository implements ExpenseRepository {
  async listExpenses(): Promise<Expense[]> {
    return read<Expense[]>(EXPENSES_KEY, []);
  }

  async createExpense(input: ExpenseInput): Promise<Expense> {
    const now = new Date().toISOString();
    const expense: Expense = {
      id: newId(),
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    write(EXPENSES_KEY, [...read<Expense[]>(EXPENSES_KEY, []), expense]);
    return expense;
  }

  async updateExpense(id: string, input: ExpenseInput): Promise<Expense> {
    const all = read<Expense[]>(EXPENSES_KEY, []);
    const existing = all.find((e) => e.id === id);
    if (!existing) throw new Error(`Expense ${id} not found`);
    const updated: Expense = {
      ...existing,
      ...input,
      updatedAt: new Date().toISOString(),
    };
    write(
      EXPENSES_KEY,
      all.map((e) => (e.id === id ? updated : e)),
    );
    return updated;
  }

  async deleteExpense(id: string): Promise<void> {
    write(
      EXPENSES_KEY,
      read<Expense[]>(EXPENSES_KEY, []).filter((e) => e.id !== id),
    );
  }

  async listCategories(): Promise<Category[]> {
    return [
      ...DEFAULT_CATEGORIES,
      ...read<Category[]>(CUSTOM_CATEGORIES_KEY, []),
    ];
  }

  async addCategory(name: string): Promise<Category> {
    const trimmed = name.trim();
    const custom = read<Category[]>(CUSTOM_CATEGORIES_KEY, []);
    const existing = [...DEFAULT_CATEGORIES, ...custom].find(
      (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) return existing;

    const category: Category = {
      id: `custom-${newId()}`,
      name: trimmed,
      color: colorForCustomCategory(custom.length),
      isDefault: false,
    };
    write(CUSTOM_CATEGORIES_KEY, [...custom, category]);
    return category;
  }

  async renameCategory(id: string, name: string): Promise<Category> {
    const trimmed = name.trim();
    const custom = read<Category[]>(CUSTOM_CATEGORIES_KEY, []);
    const target = custom.find((c) => c.id === id);
    if (!target) throw new Error("Only your own categories can be renamed");
    if (!trimmed) throw new Error("Enter a name");
    const clash = [...DEFAULT_CATEGORIES, ...custom].some((c) => c.id !== id && c.name.toLowerCase() === trimmed.toLowerCase());
    if (clash) throw new Error(`You already have a category called “${trimmed}”`);
    const updated = { ...target, name: trimmed };
    write(CUSTOM_CATEGORIES_KEY, custom.map((c) => (c.id === id ? updated : c)));
    return updated;
  }

  async deleteCategory(id: string): Promise<void> {
    const custom = read<Category[]>(CUSTOM_CATEGORIES_KEY, []);
    if (!custom.some((c) => c.id === id)) throw new Error("Only your own categories can be removed");
    write(CUSTOM_CATEGORIES_KEY, custom.filter((c) => c.id !== id));
  }
}
