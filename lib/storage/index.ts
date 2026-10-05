import type { ExpenseRepository } from "@/lib/domain/types";
import { LocalStorageExpenseRepository } from "./local-storage-expense-repository";

/** The single place that decides which storage backs the app. */
export const expenseRepository: ExpenseRepository =
  new LocalStorageExpenseRepository();
