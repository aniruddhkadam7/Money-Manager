"use client";

import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { formatHeadlineINR } from "@/lib/charts/format";
import { activityHref } from "@/lib/charts/links";
import { daysBetween, formatDisplayDate, monthEnd, monthStart, todayISO } from "@/lib/domain/dates";
import { cardBillStatus, type CardBillStatus } from "@/lib/finance/card-bill-status";
import { billPaymentsRecordedAsSpending, cardSpending } from "@/lib/finance/card-spend";
import type { FinancialState } from "@/lib/finance/state";
import type { Book } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { ChartCard } from "../charts/primitives";
import { PictureIcon } from "../picture-icon";
import { useStatements } from "../statements/statements-provider";
import { BillPaymentsFix } from "./card-paid";

/**
 * Each credit card: what you owe on it now (from your entries), this month's spending and payments on it,
 * and, when the card statement prints it, the bill with its due date and how much of it is paid.
 */
export function CardsSection({ book, state, ym, className }: { book: Book; state: FinancialState; ym: string; className?: string }) {
  const statements = useStatements();
  const from = monthStart(ym);
  const to = monthEnd(ym);
  const month = cardSpending(book, from, to);
  const unrecognisedPayments = billPaymentsRecordedAsSpending(book).length > 0;

  const rows = state.accounts
    .filter((a) => a.account.type === "credit_card")
    .map((c) => ({
      ...c,
      month: month.byCard.find((x) => x.accountId === c.account.id),
      used: book.events.some(
        (e) => ("accountId" in e && e.accountId === c.account.id) || (e.type === "transfer" && (e.toAccountId === c.account.id || e.fromAccountId === c.account.id)),
      ),
    }))
    .filter((c) => c.used || c.balanceMinor !== 0 || unrecognisedPayments);
  if (rows.length === 0) return null;
  const owed = rows.reduce((t, c) => t + Math.max(0, c.balanceMinor), 0);

  return (
    <div className={className}>
      <ChartCard title="Credit cards" action={<Link href="/money#cards-loans" className="text-xs font-medium text-emerald-700 hover:underline">All cards</Link>}>
        <p className="text-sm text-slate-500">
          <span className="text-lg font-semibold tabular-nums text-slate-900">{formatHeadlineINR(owed)}</span> owed on {rows.length === 1 ? "your card" : `${rows.length} cards`} right now
        </p>
        <ul className="mt-3 grid gap-3">
          {rows.map((c) => {
            const imports = statements.imports.filter((i) => i.accountId === c.account.id && i.status !== "FAILED");
            const status = cardBillStatus(book, c.account.id, imports.map((i) => i.cardBill ?? {}));
            return (
              <li key={c.account.id} className="rounded-xl border p-3">
                <Link href={activityHref({ account: c.account.id })} className="flex items-center gap-3">
                  <PictureIcon name="credit-card" className="size-9" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold hover:underline">{c.account.name}</span>
                    <span className="text-xs tabular-nums text-slate-500">
                      This month: spent {formatHeadlineINR(c.month?.spentMinor ?? 0)} · paid {formatHeadlineINR(c.month?.paidMinor ?? 0)}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className={cn("block font-semibold tabular-nums", c.balanceMinor < 0 ? "text-emerald-700" : "text-slate-900")}>
                      {formatHeadlineINR(Math.abs(c.balanceMinor))}
                    </span>
                    <span className="text-[11px] text-slate-500">{c.balanceMinor < 0 ? "in credit" : "owed now"}</span>
                  </span>
                </Link>
                {status && <BillStatus status={status} />}
              </li>
            );
          })}
        </ul>
        <BillPaymentsFix cards={rows} />
        <p className="mt-2 text-[11px] text-slate-400">Card purchases count in your spending when you buy; paying the bill isn&apos;t counted again.</p>
      </ChartCard>
    </div>
  );
}

/** The bill as printed on the latest card statement, and how much of it your entries show as paid. */
function BillStatus({ status }: { status: CardBillStatus }) {
  const { latest, paidSinceMinor, remainingMinor, previous } = status;
  const daysLeft = latest.dueDate ? daysBetween(todayISO(), latest.dueDate) : null;
  const paidShare = latest.billMinor > 0 ? Math.min(1, paidSinceMinor / latest.billMinor) : 1;
  const paidInFull = remainingMinor === 0;

  return (
    <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs" data-testid="card-bill">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-slate-500">Bill on the {formatDisplayDate(latest.statementDate)} statement</span>
        <span className="text-sm font-semibold tabular-nums text-slate-900">{formatHeadlineINR(latest.billMinor)}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden>
        <div className={cn("h-full rounded-full", paidInFull ? "bg-emerald-500" : "bg-amber-500")} style={{ width: `${paidShare * 100}%` }} />
      </div>
      {paidInFull ? (
        <p className="mt-2 flex items-center gap-1.5 font-medium text-emerald-700">
          <CheckCircle2 className="size-3.5" /> Paid in full
        </p>
      ) : (
        <p className={cn("mt-2 flex flex-wrap items-center gap-1.5 font-medium", daysLeft !== null && daysLeft < 0 ? "text-rose-700" : daysLeft !== null && daysLeft <= 5 ? "text-amber-700" : "text-slate-800")}>
          {daysLeft !== null && daysLeft < 0 ? <AlertCircle className="size-3.5" /> : <Clock className="size-3.5" />}
          {formatHeadlineINR(remainingMinor)} left to pay
          {latest.dueDate && (
            <span className="font-normal text-slate-500">
              · due {formatDisplayDate(latest.dueDate)} ({daysLeft! < 0 ? `${-daysLeft!} days overdue` : daysLeft === 0 ? "today" : `in ${daysLeft} days`})
            </span>
          )}
        </p>
      )}
      <p className="mt-1 tabular-nums text-slate-500">
        Paid {formatHeadlineINR(paidSinceMinor)} since that statement
        {latest.minimumDueMinor !== undefined && !paidInFull ? ` · minimum due ${formatHeadlineINR(latest.minimumDueMinor)}` : ""}
      </p>
      {previous && (
        <p className={cn("mt-1 tabular-nums", previous.paidInFull ? "text-emerald-700" : "text-amber-700")}>
          Previous bill {formatHeadlineINR(previous.info.billMinor)} ({formatDisplayDate(previous.info.statementDate)}): {previous.paidInFull ? "paid in full" : `paid ${formatHeadlineINR(previous.paidMinor)}`}
        </p>
      )}
    </div>
  );
}
