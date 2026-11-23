"use client";

import { useState } from "react";
import { CalendarClock, Calculator, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDisplayDate, formatMonthYear } from "@/lib/domain/dates";
import { formatRupees } from "@/lib/finance/describe";
import { loanProgress } from "@/lib/finance/loan";
import type { Account } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { useEventDialog } from "../events/event-dialog";
import { useFinance } from "../finance-provider";

const pct = (bps: number) => `${(bps / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;

/**
 * Under a loan on the Money page: the next EMI with its interest and principal, how far along it is, and what's left
 * to pay (from what's actually owed, so prepayments count). Pay EMI and the full schedule are a tap away. A loan
 * without its terms gets a nudge to add them.
 */
export function LoanPanel({
  account,
  owedMinor,
  onAddDetails,
  onPlan,
}: {
  account: Account;
  owedMinor: number;
  onAddDetails: () => void;
  /** Opens the calculator on this loan (prepay, rate change, switch lender…), with the EMIs left. */
  onPlan?: (monthsLeft: number) => void;
}) {
  const { book, today } = useFinance();
  const { openAdd } = useEventDialog();
  const [schedule, setSchedule] = useState(false);
  const terms = account.loanTerms;

  if (!terms) {
    return (
      <button type="button" onClick={onAddDetails} className="mt-2 w-full rounded-lg border border-dashed px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/50" data-testid="loan-add-details">
        <span className="font-medium text-primary">Add its interest rate and tenure</span> to see the EMI, the schedule, what&apos;s left, and get a reminder before each EMI.
      </button>
    );
  }

  const p = loanProgress(account, terms, book, owedMinor);
  const done = p.owedMinor <= 0;
  const overdue = p.next && p.next.date < today;

  return (
    <div className="mt-2 grid gap-2.5 rounded-xl bg-muted/40 p-3 text-sm" data-testid="loan-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {done ? (
            <p className="font-medium text-emerald-700">Fully repaid</p>
          ) : p.next ? (
            <>
              <p className={cn("text-xs", overdue ? "text-amber-700" : "text-muted-foreground")}>
                {overdue ? "EMI was due" : "Next EMI"} {formatDisplayDate(p.next.date)} · {p.next.n} of {p.emisPaid + p.emisLeft}
              </p>
              <p className="text-base font-semibold tabular-nums">{formatRupees(p.next.emiMinor)}</p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {formatRupees(p.next.interestMinor)} interest · {formatRupees(p.next.principalMinor)} principal
              </p>
            </>
          ) : null}
        </div>
        {!done && (
          <Button size="sm" onClick={() => openAdd("emi_payment", { loanId: account.id })} data-testid="loan-pay-emi">
            <CalendarClock /> Pay EMI
          </Button>
        )}
      </div>

      {/* How much of the amount borrowed is repaid. */}
      <div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="progressbar" aria-valuenow={Math.round(p.repaidShare * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Repaid">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${p.repaidShare * 100}%` }} />
        </div>
        <p className="mt-1 flex justify-between text-xs tabular-nums text-muted-foreground">
          <span>{Math.round(p.repaidShare * 100)}% repaid · {p.emisPaid} EMIs paid</span>
          <span>{p.emisLeft} left</span>
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs tabular-nums sm:grid-cols-4">
        <Stat label="Borrowed" value={formatRupees(terms.principalMinor)} />
        <Stat label="Rate" value={`${pct(terms.annualRateBps)} a year`} />
        <Stat label="Interest still to pay" value={formatRupees(p.interestLeftMinor)} tone="text-rose-600" />
        <Stat label="Ends" value={p.lastEmiDate ? formatMonthYear(p.lastEmiDate.slice(0, 7)) : "—"} />
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setSchedule(true)} data-testid="loan-schedule-open">
          <ListOrdered /> EMI schedule
        </Button>
        {onPlan && !done && (
          <Button size="sm" variant="outline" onClick={() => onPlan(p.emisLeft)} data-testid="loan-plan">
            <Calculator /> Plan: prepay, rate, switch
          </Button>
        )}
      </div>
      {schedule && <ScheduleDialog account={account} owedMinor={owedMinor} onClose={() => setSchedule(false)} />}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("truncate font-medium text-foreground", tone)}>{value}</dd>
    </div>
  );
}

/**
 * The loan month by month: the plan as sanctioned, and the rest of it from what's owed now. Each EMI's interest and
 * principal, and what's owed after it; EMIs already paid are dimmed and the next one is marked.
 */
function ScheduleDialog({ account, owedMinor, onClose }: { account: Account; owedMinor: number; onClose: () => void }) {
  const { book } = useFinance();
  const terms = account.loanTerms!;
  const p = loanProgress(account, terms, book, owedMinor);
  // Paid rows come from the original plan; from the next EMI on, from what's actually owed.
  const rows = [...p.plan.rows.slice(0, p.emisPaid).map((r) => ({ ...r, paid: true })), ...p.ahead.map((r) => ({ ...r, paid: false }))];
  const nextN = p.next?.n;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{account.name}: EMI schedule</DialogTitle>
          <DialogDescription>
            {formatRupees(terms.principalMinor)} at {pct(terms.annualRateBps)} a year for {terms.tenureMonths % 12 === 0 ? `${terms.tenureMonths / 12} years` : `${terms.tenureMonths} months`}. EMI{" "}
            {formatRupees(p.plan.emiMinor)}.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-2 text-sm tabular-nums sm:grid-cols-4">
          <Box label="Still owed" value={formatRupees(p.owedMinor)} />
          <Box label="Interest left" value={formatRupees(p.interestLeftMinor)} />
          <Box label="Total interest (plan)" value={formatRupees(p.plan.totalInterestMinor)} />
          <Box label="Total repaid (plan)" value={formatRupees(p.plan.totalPaidMinor)} />
        </dl>
        {p.interestPaidMinor > 0 && (
          <p className="text-xs text-muted-foreground">
            Recorded so far: {formatRupees(p.principalPaidMinor)} principal and {formatRupees(p.interestPaidMinor)} interest.
          </p>
        )}

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs tabular-nums" data-testid="loan-schedule">
            <thead className="sticky top-0 z-10 bg-card text-muted-foreground shadow-[0_1px_0_var(--border)] [&_th]:bg-muted/60">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">#</th>
                <th className="px-2 py-1.5 text-left font-medium">Date</th>
                <th className="px-2 py-1.5 text-right font-medium">EMI</th>
                <th className="px-2 py-1.5 text-right font-medium">Interest</th>
                <th className="px-2 py-1.5 text-right font-medium">Principal</th>
                <th className="px-2 py-1.5 text-right font-medium">Owed after</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.n} className={cn(r.paid && "text-muted-foreground opacity-60", r.n === nextN && "bg-primary/10 font-medium")}>
                  <td className="px-2 py-1.5">{r.n}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{formatDisplayDate(r.date)}</td>
                  <td className="px-2 py-1.5 text-right">{formatRupees(r.emiMinor)}</td>
                  <td className="px-2 py-1.5 text-right">{formatRupees(r.interestMinor)}</td>
                  <td className="px-2 py-1.5 text-right">{formatRupees(r.principalMinor)}</td>
                  <td className="px-2 py-1.5 text-right">{formatRupees(r.balanceMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-2.5 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
