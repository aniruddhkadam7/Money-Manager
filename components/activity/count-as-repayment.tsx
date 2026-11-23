"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatRupees } from "@/lib/finance/describe";
import { formatDisplayDate } from "@/lib/domain/dates";
import { involvesPerson } from "@/lib/finance/person-summary";
import type { EventDraft, FinancialEvent, Person } from "@/lib/finance/types";
import { useFinance } from "../finance-provider";
import { useToast } from "../toast";

/** What an entry was, as a draft, so a changed entry can be put back exactly (Undo). */
const asDraft = (e: FinancialEvent): EventDraft => {
  const { id: _id, createdAt: _c, updatedAt: _u, sources: _s, ...rest } = e;
  void _id;
  void _c;
  void _u;
  void _s;
  return rest as EventDraft;
};

/**
 * On a person's page, when money passed between you that's recorded as ordinary spending (or income), say a UPI
 * payment from a bank statement naming them, while there's a debt between you: offer to count those payments
 * against it. Paying someone you owe becomes paying them back (so what you owe goes down, and it stops counting as
 * spending); money from someone who owes you becomes them paying you back. Only payments made after the debt began,
 * from a bank or cash, and no more than what's owed. Undo puts them back.
 */
export function CountAsRepayment({ person, only }: { person: Person; /** Just one side: what you paid them, or what they paid you. */ only?: "paid" | "received" }) {
  const f = useFinance();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const summary = f.state.people.find((p) => p.person.id === person.id);
  const iOwe = Math.max(0, summary?.iOwe.outstandingMinor ?? 0);
  const theyOwe = Math.max(0, summary?.owedToMe.outstandingMinor ?? 0);

  const plan = useMemo(() => {
    const moneyAccount = (id: string) => {
      const t = f.book.accounts.find((a) => a.id === id)?.type;
      return t === "bank" || t === "cash";
    };
    const pick = (owed: number, debtTypes: FinancialEvent["type"][], payType: "expense" | "income") => {
      if (owed <= 0) return { entries: [] as Extract<FinancialEvent, { type: "expense" | "income" }>[], firstDebt: null };
      const debts = f.book.events.filter((e) => debtTypes.includes(e.type) && "personId" in e && e.personId === person.id).sort((a, b) => a.date.localeCompare(b.date));
      if (debts.length === 0) return { entries: [], firstDebt: null };
      const candidates = f.book.events
        .filter((e) => e.type === payType && moneyAccount(e.accountId) && involvesPerson(e, person))
        .sort((a, b) => a.date.localeCompare(b.date)) as Extract<FinancialEvent, { type: "expense" | "income" }>[];
      const chosen: typeof candidates = [];
      let total = 0;
      for (const e of candidates) {
        if (total + e.amountMinor > owed) continue;
        chosen.push(e);
        total += e.amountMinor;
      }
      // Paid before the debt's recorded date: it plainly existed by then, so the debt is dated from the first payment.
      const firstDebt = chosen.length > 0 && chosen[0].date < debts[0].date ? { event: debts[0], date: chosen[0].date } : null;
      return { entries: chosen, firstDebt };
    };
    return {
      paid: pick(iOwe, ["borrow"], "expense"),
      received: pick(theyOwe, ["lend", "split_expense", "reimbursable_expense"], "income"),
    };
  }, [f.book, person, iOwe, theyOwe]);

  type Plan = (typeof plan)["paid"];
  const convert = ({ entries, firstDebt }: Plan, to: "repayment_made" | "repayment_received") => {
    setBusy(true);
    const before = [...(firstDebt ? [firstDebt.event] : []), ...entries].map((e) => ({ id: e.id, draft: asDraft(e) }));
    if (firstDebt) f.updateEvent(firstDebt.event.id, { ...asDraft(firstDebt.event), date: firstDebt.date } as EventDraft);
    let done = 0;
    for (const e of entries) {
      if (e.type !== "expense" && e.type !== "income") continue;
      const draft: EventDraft = {
        type: to,
        date: e.date,
        personId: person.id,
        accountId: e.accountId,
        amountMinor: e.amountMinor,
        ...(e.description ? { description: e.description } : {}),
        ...(e.note ? { note: e.note } : {}),
        ...(e.offStatement ? { offStatement: true } : {}),
      };
      if (f.updateEvent(e.id, draft).ok) done++;
    }
    setBusy(false);
    const total = entries.slice(0, done).reduce((t, e) => t + ("amountMinor" in e ? e.amountMinor : 0), 0);
    toast.show({
      message: `${done} ${done === 1 ? "payment" : "payments"} (${formatRupees(total)}) now count as ${to === "repayment_made" ? `paying ${person.name} back` : `${person.name} paying you back`}.`,
      actionLabel: "Undo",
      onAction: () => {
        // Payments first, then the debt's date, so each step is valid on the way back.
        for (const b of [...before].reverse()) f.updateEvent(b.id, b.draft);
      },
      duration: 8000,
    });
  };

  const banner = (p: Plan, to: "repayment_made" | "repayment_received") => {
    const { entries, firstDebt } = p;
    const total = entries.reduce((t, e) => t + ("amountMinor" in e ? e.amountMinor : 0), 0);
    const owe = to === "repayment_made";
    return (
      <div className="grid w-full basis-full gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid={owe ? "count-paid-back" : "count-received-back"}>
        <p>
          {owe ? (
            <>
              <strong>{formatRupees(total)}</strong> you paid {person.name} ({entries.length} {entries.length === 1 ? "payment" : "payments"}) is recorded as spending, so you still show as owing{" "}
              <strong>{formatRupees(iOwe)}</strong>.
            </>
          ) : (
            <>
              <strong>{formatRupees(total)}</strong> from {person.name} ({entries.length} {entries.length === 1 ? "payment" : "payments"}) is recorded as income, so they still show as owing you{" "}
              <strong>{formatRupees(theyOwe)}</strong>.
            </>
          )}
        </p>
        {firstDebt && (
          <p className="text-xs text-muted-foreground">
            The first payment is from {formatDisplayDate(firstDebt.date)}, before the debt&apos;s date ({formatDisplayDate(firstDebt.event.date)}), so the debt will be dated {formatDisplayDate(firstDebt.date)}.
          </p>
        )}
        <Button size="sm" className="justify-self-start" disabled={busy} onClick={() => convert(p, to)}>
          {owe ? `Count it as paying back (you'd owe ${formatRupees(iOwe - total)})` : `Count it as them paying back (they'd owe ${formatRupees(theyOwe - total)})`}
        </Button>
      </div>
    );
  };

  const showPaid = only !== "received" && plan.paid.entries.length > 0;
  const showReceived = only !== "paid" && plan.received.entries.length > 0;
  if (!showPaid && !showReceived) return null;
  return (
    <>
      {showPaid && banner(plan.paid, "repayment_made")}
      {showReceived && banner(plan.received, "repayment_received")}
    </>
  );
}
