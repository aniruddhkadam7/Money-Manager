import { formatRupees } from "@/lib/finance/describe";
import type { Account } from "@/lib/finance/types";
import { EVENT_DIRECTIONS, SUPPORTED_EVENT_TYPES, type Classification, type Direction, type RowStatus, type StatementEventType } from "@/lib/statements/types";

export const EVENT_LABEL: Record<StatementEventType, string> = {
  EXPENSE: "Expense",
  INCOME: "Income",
  TRANSFER: "Moved between my accounts",
  MONEY_LENT: "I lent money",
  MONEY_BORROWED: "I borrowed money",
  LENDING_REPAYMENT: "They paid me back",
  BORROWING_REPAYMENT: "I paid them back",
  SPLIT_EXPENSE: "Split bill",
  REIMBURSEMENT: "Reimbursement",
  INVESTMENT: "Investment",
  INVESTMENT_SELL: "Investment sold",
  ASSET_PURCHASE: "Asset purchase",
  ASSET_SALE: "Asset sale",
  LOAN_TAKEN: "Loan taken",
  LOAN_REPAYMENT: "Loan EMI",
  CREDIT_CARD_PAYMENT: "Credit card bill",
};

const ORDER: Record<Direction, StatementEventType[]> = {
  debit: ["EXPENSE", "MONEY_LENT", "BORROWING_REPAYMENT", "TRANSFER", "INVESTMENT", "CREDIT_CARD_PAYMENT", "LOAN_REPAYMENT", "REIMBURSEMENT"],
  credit: ["INCOME", "LENDING_REPAYMENT", "MONEY_BORROWED", "TRANSFER", "INVESTMENT_SELL", "REIMBURSEMENT"],
};

/** The choices offered for a line: the suggestion and its alternatives first, then everything else that makes sense. */
export function optionsFor(direction: Direction, c?: Classification): StatementEventType[] {
  const ok = (t: StatementEventType) => SUPPORTED_EVENT_TYPES.includes(t) && EVENT_DIRECTIONS[t].includes(direction);
  const first = [c?.eventType, ...(c?.alternatives ?? [])].filter((t): t is StatementEventType => !!t && ok(t));
  return [...new Set([...first, ...ORDER[direction]])];
}

/** "Expense · Food", "Lent to Rahul", "Moved to Cash"... */
export function describeClassification(c: Classification, direction: Direction, accounts: Account[]): string {
  const acct = accounts.find((a) => a.id === c.counterAccountId)?.name;
  switch (c.eventType) {
    case "EXPENSE": return `Expense · ${c.category ?? "Other"}`;
    case "INCOME": return `Income · ${c.category ?? "Other income"}`;
    case "TRANSFER": return acct ? (direction === "debit" ? `Moved to ${acct}` : `Moved from ${acct}`) : "Moved between my accounts";
    case "MONEY_LENT": return c.person ? `Lent to ${c.person}` : "I lent money";
    case "MONEY_BORROWED": return c.person ? `Borrowed from ${c.person}` : "I borrowed money";
    case "LENDING_REPAYMENT": return c.person ? `${c.person} paid me back` : "They paid me back";
    case "BORROWING_REPAYMENT": return c.person ? `Paid back ${c.person}` : "I paid them back";
    case "REIMBURSEMENT": return c.person ? `Reimbursement · ${c.person}` : "Reimbursement";
    case "INVESTMENT": return c.holding ? `Invested in ${c.holding}` : "Investment";
    case "INVESTMENT_SELL": return c.holding ? `Sold ${c.holding}` : "Investment sold";
    case "CREDIT_CARD_PAYMENT": return acct ? `Paid ${acct} bill` : "Credit card bill";
    case "LOAN_REPAYMENT": return acct ? `${acct} EMI` : "Loan EMI";
    default: return EVENT_LABEL[c.eventType];
  }
}

export const STATUS_LABEL: Record<RowStatus, string> = {
  pending: "Pending",
  auto: "Will import",
  auto_flagged: "Will import · check",
  review: "Needs you",
  matched_existing: "Already in your records",
  already_imported: "Imported before",
  possible_duplicate: "Possible duplicate",
  skipped: "Skipped",
  imported: "Imported",
  failed: "Failed",
};

export const SOURCE_LABEL: Record<Classification["source"], string> = {
  user_rule: "Learned from you",
  rule: "Rule",
  relationship: "Your records",
  ai: "AI",
  user: "You",
};

export const signedAmount = (direction: Direction, amountMinor: number) => `${direction === "credit" ? "+" : "−"}${formatRupees(amountMinor)}`;
