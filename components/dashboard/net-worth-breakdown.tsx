"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ListTree } from "lucide-react";
import { formatExactINR } from "@/lib/charts/format";
import { activityHref } from "@/lib/charts/links";
import { formatDisplayDate } from "@/lib/domain/dates";
import type { FinancialState } from "@/lib/finance/state";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

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

function Group({ title, lines, totalMinor, empty }: { title: string; lines: Line[]; totalMinor: number; empty: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {lines.length === 0 ? (
        <p className="py-2 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {lines.map((l) => (
            <li key={l.key}>
              <Link href={l.href} className="flex items-center justify-between gap-3 py-2 hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">{l.label}</span>
                  {l.note && <span className="block text-xs text-slate-500">{l.note}</span>}
                </span>
                <span className={cn("shrink-0 text-sm font-semibold tabular-nums", l.amountMinor < 0 && "text-red-700")}>{formatExactINR(l.amountMinor)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1 flex justify-between border-t border-slate-300 pt-2 text-sm font-semibold">
        <span>Total {title.toLowerCase()}</span>
        <span className="tabular-nums">{formatExactINR(totalMinor)}</span>
      </div>
    </div>
  );
}

/** "How it adds up": opens the itemised net worth. */
export function NetWorthBreakdown({ state, children }: { state: FinancialState; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { own, owe } = buildBreakdown(state);
  const nw = state.netWorthMinor;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-white hover:text-slate-900"
        data-testid="net-worth-breakdown"
      >
        <ListTree className="size-3.5" /> {children ?? "How it adds up"}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>How your net worth adds up</DialogTitle>
            <DialogDescription>Everything you own, less everything you owe, as of {formatDisplayDate(state.asOf)}. Tap a line to see its entries.</DialogDescription>
          </DialogHeader>
          <Group title="What you own" lines={own} totalMinor={state.assets.totalMinor} empty="Nothing recorded yet." />
          <Group title="What you owe" lines={owe} totalMinor={state.liabilities.totalMinor} empty="You don't owe anything." />
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <div className="flex justify-between tabular-nums text-slate-600">
              <span>What you own</span>
              <span>{formatExactINR(state.assets.totalMinor)}</span>
            </div>
            <div className="flex justify-between tabular-nums text-slate-600">
              <span>− What you owe</span>
              <span>{formatExactINR(state.liabilities.totalMinor)}</span>
            </div>
            <div className={cn("mt-1 flex justify-between border-t border-slate-200 pt-1 text-base font-semibold tabular-nums", nw < 0 ? "text-rose-600" : "text-slate-900")}>
              <span>= Net worth</span>
              <span>{formatExactINR(nw)}</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
