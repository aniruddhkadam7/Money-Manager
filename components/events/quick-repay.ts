"use client";

import { todayISO } from "@/lib/domain/dates";
import { formatRupees } from "@/lib/finance/describe";
import { CASH_ACCOUNT_TYPES } from "@/lib/finance/types";
import { useFinance } from "../finance-provider";
import { useToast } from "../toast";

/**
 * "They paid me": records the whole outstanding amount as repaid today, straight away, with Undo.
 * The money lands in the account the latest loan to them went out from (or the first bank/cash account).
 */
export function useQuickRepaymentReceived(): (personId: string) => void {
  const { book, state, addEvent, deleteEvent } = useFinance();
  const toast = useToast();

  return (personId) => {
    const person = state.people.find((p) => p.person.id === personId);
    const amountMinor = person?.owedToMe.outstandingMinor ?? 0;
    if (!person || amountMinor <= 0) return;

    const lastLend = [...book.events]
      .filter((e) => e.type === "lend" && e.personId === personId)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const accountId =
      (lastLend && "accountId" in lastLend && book.accounts.some((a) => a.id === lastLend.accountId) ? lastLend.accountId : undefined) ??
      book.accounts.find((a) => CASH_ACCOUNT_TYPES.includes(a.type))?.id;
    if (!accountId) {
      toast.show({ message: "Add a bank or cash account first, on the Money page." });
      return;
    }

    const r = addEvent({ type: "repayment_received", personId, accountId, amountMinor, date: todayISO() });
    if (!r.ok) {
      toast.show({ message: r.issues[0]?.message ?? "Couldn't record that." });
      return;
    }
    const eventId = r.value;
    toast.show({
      message: `${person.person.name} paid you back ${formatRupees(amountMinor)}`,
      actionLabel: "Undo",
      onAction: () => deleteEvent(eventId),
      duration: 8000,
    });
  };
}
