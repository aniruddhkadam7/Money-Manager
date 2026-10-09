import { idOf } from "./engine";
import { isMoneyBack, periodReport } from "./state";
import type { Book, FlowKind, Ledger } from "./types";

/**
 * "How it adds up" for the dashboard's numbers. Every explanation is built from the same ledger entries as
 * the number it explains, so its lines always add up to that number exactly.
 */

export interface ExplainLine {
  label: string;
  note?: string;
  amountMinor: number;
}

export interface ExplainGroup {
  label: string;
  amountMinor: number;
  lines: ExplainLine[];
}

const byAmount = (a: { amountMinor: number }, b: { amountMinor: number }) => Math.abs(b.amountMinor) - Math.abs(a.amountMinor);

/** Lines keyed by label, summed. */
function tally() {
  const m = new Map<string, ExplainLine>();
  return {
    add(label: string, amountMinor: number, note?: string) {
      const l = m.get(label);
      if (l) l.amountMinor += amountMinor;
      else m.set(label, { label, note, amountMinor });
    },
    lines: () => [...m.values()].filter((l) => l.amountMinor !== 0).sort(byAmount),
  };
}

const isBalanceSheet = (ledger: string) => ledger.startsWith("acct:") || ledger.startsWith("recv:") || ledger.startsWith("pay:");

/**
 * Why net worth moved between the end of `afterDate` and the end of `to`. In double entry, an entry's effect
 * on net worth is the opposite of what it posts to income, spending, gains and starting balances, so the
 * groups below always sum to the change.
 */
export function explainNetWorthChange(book: Book, ledger: Ledger, afterDate: string, to: string, categoryName: (id: string) => string): { totalMinor: number; groups: ExplainGroup[] } {
  const moneyBack = new Set(book.events.filter(isMoneyBack).map((e) => e.id));
  const income = tally();
  const spending = tally();
  const back = tally();
  const gains = tally();
  const opening = tally();
  const accountName = (id: string) => book.accounts.find((a) => a.id === id)?.name ?? "Account";
  const personName = (id: string) => book.people.find((p) => p.id === id)?.name ?? "Someone";

  for (const entry of ledger.entries) {
    if (entry.date <= afterDate || entry.date > to) continue;
    for (const p of entry.postings) {
      if (isBalanceSheet(p.ledger)) continue;
      const effect = -p.amountMinor;
      if (p.ledger.startsWith("exp:")) spending.add(categoryName(idOf(p.ledger)), effect);
      else if (p.ledger.startsWith("inc:")) (moneyBack.has(entry.sourceId) ? back : income).add(categoryName(idOf(p.ledger)), effect);
      else if (p.ledger.startsWith("gain:")) gains.add(p.ledger === "gain:realized" ? "Gain or loss on sales" : "Change in investment value", effect);
      else {
        // Starting balances, and debts from before records began: named after the entry, not the account it touched.
        const event = entry.kind === "opening" ? undefined : book.events.find((e) => e.id === entry.sourceId);
        const who = event && "personId" in event ? personName(event.personId) : null;
        const label =
          entry.kind === "opening"
            ? `${accountName(entry.sourceId.replace(/^opening:/, ""))}: starting balance`
            : event?.type === "borrow" && who
              ? `${who}: owed from before tracking`
              : event?.type === "lend" && who
                ? `${who}: lent before tracking`
                : event?.type === "repayment_made" && who
                  ? `Paid back ${who} (debt from before tracking)`
                  : event?.type === "repayment_received" && who
                    ? `${who} paid you back (from before tracking)`
                    : "From before tracking";
        opening.add(label, effect);
      }
    }
  }

  const group = (label: string, lines: ExplainLine[]): ExplainGroup => ({ label, lines, amountMinor: lines.reduce((t, l) => t + l.amountMinor, 0) });
  const groups = [
    group("Income", income.lines()),
    group("Spending", spending.lines()),
    group("Refunds & reimbursements", back.lines()),
    group("Investments", gains.lines()),
    group("Starting balances & old debts", opening.lines()),
  ].filter((g) => g.lines.length > 0);
  return { totalMinor: groups.reduce((t, g) => t + g.amountMinor, 0), groups };
}

/** "Spent" for a period: each category (refunds paired with a purchase already taken off it), less other refunds. */
export function explainSpent(book: Book, ledger: Ledger, from: string, to: string, categoryName: (id: string) => string) {
  const r = periodReport(book, ledger, from, to);
  const lines: ExplainLine[] = r.expensesByCategory.map((c) => ({ label: categoryName(c.categoryId), amountMinor: c.amountMinor }));
  const categorised = lines.reduce((t, l) => t + l.amountMinor, 0);
  const otherRefunds = categorised - r.expensesMinor;
  if (otherRefunds !== 0) lines.push({ label: "Refunds not tied to a purchase", note: "Taken off the total", amountMinor: -otherRefunds });
  return { totalMinor: r.expensesMinor, lines };
}

/** "Income" for a period by category (refunds and reimbursements are not income), and what was saved. */
export function explainIncome(book: Book, ledger: Ledger, from: string, to: string, categoryName: (id: string) => string) {
  const r = periodReport(book, ledger, from, to);
  return {
    totalMinor: r.incomeMinor,
    spentMinor: r.expensesMinor,
    savedMinor: r.savingsMinor,
    lines: r.incomeByCategory.map((c) => ({ label: categoryName(c.categoryId), amountMinor: c.amountMinor })),
  };
}

const FLOW_IN: Partial<Record<FlowKind, string>> = {
  income: "Income & refunds",
  borrowing: "Borrowed / repaid to you",
  lending: "Repaid to you",
  transfer: "Moved in from your accounts",
  investment: "From selling investments",
  debt_payment: "Bill payments received",
  expense: "Refunds",
};
const FLOW_OUT: Partial<Record<FlowKind, string>> = {
  expense: "Spent",
  debt_payment: "Card & loan bills paid",
  lending: "Lent out",
  borrowing: "Paid back",
  transfer: "Moved to your accounts",
  investment: "Invested",
  income: "Income reversed",
};

/**
 * An account's balance: its starting balance, then everything in and out, by kind. For a card or loan the
 * signs are turned so it reads as what you owe: purchases add, payments take off.
 */
export function explainAccountBalance(book: Book, ledger: Ledger, accountId: string, asOf: string) {
  const account = book.accounts.find((a) => a.id === accountId);
  const debt = account?.type === "credit_card" || account?.type === "loan";
  const sign = debt ? -1 : 1;
  const lines = tally();
  let start = 0;
  for (const entry of ledger.entries) {
    if (entry.date > asOf) continue;
    for (const p of entry.postings) {
      if (p.ledger !== `acct:${accountId}`) continue;
      const amount = sign * p.amountMinor;
      if (entry.kind === "opening") start += amount;
      else if (debt) lines.add(p.amountMinor < 0 ? "Purchases & charges" : "Payments & refunds", amount);
      else lines.add((p.amountMinor > 0 ? FLOW_IN : FLOW_OUT)[entry.flow] ?? (p.amountMinor > 0 ? "Money in" : "Money out"), amount);
    }
  }
  const moves = lines.lines();
  return { startMinor: start, openedOn: account?.openedOn, lines: moves, totalMinor: start + moves.reduce((t, l) => t + l.amountMinor, 0) };
}
