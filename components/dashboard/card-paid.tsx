"use client";

import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatHeadlineINR } from "@/lib/charts/format";
import { billPaymentsRecordedAsSpending } from "@/lib/finance/card-spend";
import type { AccountBalance } from "@/lib/finance/state";
import type { FinancialEvent } from "@/lib/finance/types";
import { useFinance } from "../finance-provider";
import { useToast } from "../toast";

/**
 * Card bill payments that were recorded as spending (CRED, "credit card" on the bank line): one tap turns
 * them into payments to the card, so the card shows paid and the money isn't counted as spending twice.
 */
export function BillPaymentsFix({ cards }: { cards: AccountBalance[] }) {
  const { book, updateEvent } = useFinance();
  const toast = useToast();
  const found = useMemo(() => billPaymentsRecordedAsSpending(book), [book]);
  const [cardId, setCardId] = useState(cards[0]?.account.id ?? "");
  if (found.length === 0 || cards.length === 0) return null;
  const total = found.reduce((t, e) => t + ("amountMinor" in e ? e.amountMinor : 0), 0);

  const fix = () => {
    let done = 0;
    for (const e of found) {
      if (e.type !== "expense") continue;
      const r = updateEvent(e.id, {
        type: "transfer",
        date: e.date,
        fromAccountId: e.accountId,
        toAccountId: cardId,
        amountMinor: e.amountMinor,
        description: e.description,
        note: e.note,
        sources: e.sources,
      });
      if (r.ok) done++;
    }
    toast.show({ message: done ? `${done} ${done === 1 ? "payment" : "payments"} now count as paying your card, not as spending` : "Those entries couldn't be changed." });
  };

  return (
    <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-testid="bill-payments-fix">
      <p className="font-medium">
        {found.length} card bill {found.length === 1 ? "payment" : "payments"} ({formatHeadlineINR(total)}) {found.length === 1 ? "is" : "are"} counted as spending
      </p>
      <p className="mt-0.5 text-xs text-amber-900/80">
        Paying the card (through CRED or your bank) isn&apos;t spending: the purchases already were. Counting them as payments to the card shows it paid and removes the double count.
      </p>
      <ul className="mt-2 grid gap-0.5 text-xs text-amber-900/80">
        {found.slice(0, 4).map((e: FinancialEvent) => (
          <li key={e.id}>
            {e.date} · {e.description ?? "Payment"} · {formatHeadlineINR("amountMinor" in e ? e.amountMinor : 0)}
          </li>
        ))}
        {found.length > 4 && <li>…and {found.length - 4} more</li>}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {cards.length > 1 && (
          <select value={cardId} onChange={(e) => setCardId(e.target.value)} className="h-10 rounded-md border bg-white px-2 text-base sm:h-8 sm:text-xs" aria-label="Which card">
            {cards.map((c) => (
              <option key={c.account.id} value={c.account.id}>
                {c.account.name}
              </option>
            ))}
          </select>
        )}
        <Button size="sm" onClick={fix} data-testid="fix-bill-payments">
          <CheckCircle2 /> Count as payments to {cards.length === 1 ? cards[0].account.name : "this card"}
        </Button>
      </div>
    </div>
  );
}
