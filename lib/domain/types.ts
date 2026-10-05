export interface Category {
  id: string;
  name: string;
  color: string;
  /** Name of a picture in components/picture-icon.tsx; unknown/missing falls back to a generic tag. */
  icon?: string;
  isDefault: boolean;
  /** Missing means `expense`. Income categories are used when recording money received. */
  kind?: "expense" | "income";
}

export interface Expense {
  id: string;
  /** Integer paise (₹1 = 100) so totals never suffer float drift. */
  amountMinor: number;
  description: string;
  categoryId: string;
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  createdAt: string;
  updatedAt: string;
}

export type ExpenseInput = Pick<
  Expense,
  "amountMinor" | "description" | "categoryId" | "date"
>;

/**
 * The only thing the UI knows about persistence. V0 implements it with
 * localStorage; a future API/database client can implement the same contract.
 */
export interface ExpenseRepository {
  listExpenses(): Promise<Expense[]>;
  createExpense(input: ExpenseInput): Promise<Expense>;
  updateExpense(id: string, input: ExpenseInput): Promise<Expense>;
  deleteExpense(id: string): Promise<void>;

  listCategories(): Promise<Category[]>;
  addCategory(name: string): Promise<Category>;
  /** Only custom categories can be renamed or removed; the built-in ones are fixed. */
  renameCategory(id: string, name: string): Promise<Category>;
  deleteCategory(id: string): Promise<void>;
}
