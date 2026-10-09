"use client";

import { useMemo } from "react";
import { deriveState } from "@/lib/finance/state";
import { useFinance } from "../finance-provider";
import { useStatements } from "./statements-provider";

/** An account's latest statement, and what the app says the account held on its last day. */
export interface StatementCheck {
  /** Last day the statement covers (`YYYY-MM-DD`). */
  date: string;
  closingMinor: number;
  /** The app's balance for the account at the end of that day. */
  appMinor: number;
  /** Bank and last four digits as the statement prints them. */
  bankHint?: string;
  accountMask?: string;
}

/** Under a rupee apart counts as matching: statements round, and a paisa off isn't worth a warning. */
export const statementMatches = (c: StatementCheck) => Math.abs(c.appMinor - c.closingMinor) < 100;

/**
 * Each account's latest statement with a closing balance. A difference between its closing balance and
 * the app's balance on that same day means an entry up to that date doesn't match the bank.
 */
export function useStatementChecks(): Map<string, StatementCheck> {
  const { book, ledger } = useFinance();
  const { imports } = useStatements();
  return useMemo(() => {
    const out = new Map<string, StatementCheck>();
    for (const i of imports) {
      if (i.status === "FAILED" || i.closingBalanceMinor == null || !i.periodEnd) continue;
      const prev = out.get(i.accountId);
      if (!prev || i.periodEnd > prev.date) {
        out.set(i.accountId, { date: i.periodEnd, closingMinor: i.closingBalanceMinor, appMinor: 0, bankHint: i.bankHint, accountMask: i.accountMask });
      }
    }
    for (const [accountId, check] of out) {
      check.appMinor = deriveState(book, ledger, check.date).accounts.find((a) => a.account.id === accountId)?.balanceMinor ?? 0;
    }
    return out;
  }, [imports, book, ledger]);
}
