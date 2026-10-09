"use client";

import { activityHref } from "@/lib/charts/links";
import { formatDisplayDate } from "@/lib/domain/dates";
import type { FinancialState } from "@/lib/finance/state";
import { ExplainSheet, HowButton, useExplain } from "../explainer";

interface Line {
  key: string;
  label: string;
  note?: string;
  amountMinor: number;
  href: string;
}

/**
 * Every item behind net worth, so it can be checked by hand: what you own (each bank and cash account,
 * investments, money people owe you, cards paid ahead) less what you owe (cards, loans, people). Built from
 * the same numbers as the headline, so the lines always add up to it exactly.
 */
export function buildBreakdown(state: FinancialState): { own: Line[]; owe: Line[] } {
  const own: Line[] = [];
  const owe: Line[] = [];
  for (const { account, balanceMinor } of state.accounts) {
    if (balanceMinor === 0) continue;
    const href = activityHref({ account: account.id });
    if (account.type === "bank" || account.type === "cash") {
      own.push({ key: account.id, label: account.name, note: account.type === "bank" ? "Bank balance" : "Cash", amountMinor: balanceMinor, href });
    } else if (account.type === "investment") {
      own.push({ key: account.id, label: account.name, note: "Investment, current value", amountMinor: balanceMinor, href });
    } else if (balanceMinor > 0) {
      owe.push({ key: account.id, label: account.name, note: account.type === "loan" ? "Loan still owed" : "Card bill to pay", amountMinor: balanceMinor, href });
    } else {
      own.push({ key: account.id, label: account.name, note: "Paid more than recorded spending", amountMinor: -balanceMinor, href });
    }
  }
  for (const p of state.people) {
    const href = activityHref({ person: p.person.id });
    if (p.owedToMe.outstandingMinor !== 0) own.push({ key: `r-${p.person.id}`, label: p.person.name, note: "Owes you", amountMinor: p.owedToMe.outstandingMinor, href });
    if (p.iOwe.outstandingMinor !== 0) owe.push({ key: `p-${p.person.id}`, label: p.person.name, note: "You owe", amountMinor: p.iOwe.outstandingMinor, href });
  }
  own.sort((a, b) => b.amountMinor - a.amountMinor);
  owe.sort((a, b) => b.amountMinor - a.amountMinor);
  return { own, owe };
}

/** The itemised net worth in a "How it adds up" sheet. */
export function NetWorthBreakdownSheet({ state, open, onOpenChange }: { state: FinancialState; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { own, owe } = buildBreakdown(state);
  return (
    <ExplainSheet
      open={open}
      onOpenChange={onOpenChange}
      title="How your net worth adds up"
      description={<>Everything you own, less everything you owe, as of {formatDisplayDate(state.asOf)}. Tap a line to see its entries.</>}
      sections={[
        { title: "What you own", rows: own, totalMinor: state.assets.totalMinor, empty: "Nothing recorded yet." },
        { title: "What you owe", rows: owe, totalMinor: state.liabilities.totalMinor, empty: "You don't owe anything." },
      ]}
      steps={[
        { label: "What you own", amountMinor: state.assets.totalMinor },
        { label: "What you owe", amountMinor: state.liabilities.totalMinor, op: "−" },
        { label: "Net worth", amountMinor: state.netWorthMinor, op: "=" },
      ]}
    />
  );
}

/** "How it adds up" under Net worth: opens the itemised net worth. */
export function NetWorthBreakdown({ state }: { state: FinancialState }) {
  const how = useExplain();
  return (
    <>
      <span data-testid="net-worth-breakdown" className="contents">
        <HowButton onClick={how.open} />
      </span>
      <NetWorthBreakdownSheet state={state} {...how.props} />
    </>
  );
}
