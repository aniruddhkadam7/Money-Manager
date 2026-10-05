"use client";

import type { ReactNode } from "react";
import { LocalStorageBookRepository } from "@/lib/finance/book-storage";
import { expenseRepository } from "@/lib/storage";
import { EventDialogProvider } from "./events/event-dialog";
import { FinanceProvider } from "./finance-provider";
import { StatementsProvider } from "./statements/statements-provider";
import { ToastProvider } from "./toast";

const bookRepository = new LocalStorageBookRepository();

/**
 * Everything is stored in this browser for now. To move it to a server, give
 * FinanceProvider a different BookRepository; the engine and UI don't change.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <FinanceProvider bookRepository={bookRepository} categoryRepository={expenseRepository}>
      <StatementsProvider>
        <ToastProvider>
          <EventDialogProvider>{children}</EventDialogProvider>
        </ToastProvider>
      </StatementsProvider>
    </FinanceProvider>
  );
}
