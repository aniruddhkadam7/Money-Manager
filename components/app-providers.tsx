"use client";

import type { ReactNode } from "react";
import { LocalStorageBookRepository } from "@/lib/finance/book-storage";
import { CloudGate } from "./cloud-gate";
import { expenseRepository } from "@/lib/storage";
import { EventDialogProvider } from "./events/event-dialog";
import { FinanceProvider } from "./finance-provider";
import { StatementsProvider } from "./statements/statements-provider";
import { ToastProvider } from "./toast";

const bookRepository = new LocalStorageBookRepository();

/**
 * Data is read and written in this browser; with Supabase set up, CloudGate signs the user in and
 * mirrors it to the cloud (lib/cloud/sync.ts), so the repositories don't change.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <CloudGate>
      <FinanceProvider bookRepository={bookRepository} categoryRepository={expenseRepository}>
        <StatementsProvider>
          <ToastProvider>
            <EventDialogProvider>{children}</EventDialogProvider>
          </ToastProvider>
        </StatementsProvider>
      </FinanceProvider>
    </CloudGate>
  );
}
