"use client";

import { useMemo } from "react";
import { cardStatementBills, cardUsage, DEFAULT_CARD_LIMIT_MINOR, type CardUsage } from "@/lib/finance/card-bill-status";
import type { FinancialState } from "@/lib/finance/state";
import type { Account } from "@/lib/finance/types";
import { anchorGaps, applyAnchorGaps, statementBalanceAt, type AnchorGap } from "@/lib/finance/statement-anchor";
import { useFinance } from "../finance-provider";
import { useStatements } from "./statements-provider";

/** An account's latest statement, and what the app says the account held on its last day. */
export interface StatementCheck {
  /** Last day the statement covers (`YYYY-MM-DD`). */
  date: string;
  closingMinor: number;
  /** What the app's entries say the statement should show that day (entries marked not in a statement left out). */
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
      check.appMinor = statementBalanceAt(book, ledger, accountId, check.date);
    }
    return out;
  }, [imports, book, ledger]);
}

/** Each bank account's gap between its latest statement and the app's entries on that statement's day. */
export function useStatementGaps(): AnchorGap[] {
  const { book, ledger } = useFinance();
  const checks = useStatementChecks();
  return useMemo(
    () => anchorGaps(book, ledger, [...checks].map(([accountId, c]) => ({ accountId, date: c.date, closingMinor: c.closingMinor }))),
    [book, ledger, checks],
  );
}

/**
 * Today's state with bank balances taken from the latest statements (closing balance plus what's recorded
 * since). Every page showing a balance or a total uses this, so Home and Money always agree.
 */
export function useBalances(): { state: FinancialState; gaps: AnchorGap[] } {
  const { state } = useFinance();
  const gaps = useStatementGaps();
  return useMemo(() => ({ state: applyAnchorGaps(state, gaps), gaps }), [state, gaps]);
}

/**
 * A card's place against its limit, from its statements: `availableMinor` is what's left to spend (the limit,
 * ₹60,000 unless set, less the unpaid bill and what's been spent since its statement).
 */
export function useCardUsage(): (account: Account, balanceMinor: number) => CardUsage & { limitMinor: number; availableMinor: number } {
  const { book } = useFinance();
  const { imports } = useStatements();
  return useMemo(
    () => (account: Account, balanceMinor: number) => {
      const usage = cardUsage(book, account.id, cardStatementBills(imports, account.id), balanceMinor);
      const limitMinor = account.creditLimitMinor ?? DEFAULT_CARD_LIMIT_MINOR;
      return { ...usage, limitMinor, availableMinor: limitMinor - usage.usedMinor };
    },
    [book, imports],
  );
}
