import type { Book } from "@/lib/finance/types";
import type { Classification, StatementRow } from "./types";

/**
 * Money coming IN on a credit card statement is either a refund / cashback, or you paying the bill.
 * A bill payment is recorded once, as money moving from your bank to the card (never spending, never
 * income). If your bank statement already recorded that exact payment, the card line is linked to it
 * instead of being added again. Nothing else in your records is changed.
 */

const MONEY_BACK = /\b(refund\w*|reversal|reversed|rev|cashback|cash back|chargeback|credit adj\w*|\w*cradj\w*)\b/i;
/** Money that is clearly not you paying a card: earnings and claims never arrive on a card. */
const NOT_A_PAYMENT = /\b(salary|sal cr|payroll|stipend|bonus|reimb\w*|interest|int\.?\s*pd|dividend|pvt|ltd|llp|technologies|solutions)\b/i;
/** The bank debit and the card credit of one payment are a few days apart. */
const LINK_WINDOW_DAYS = 7;

const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/** The bank account most used in your records ("Net banking" when none is used yet). */
export function mainBankAccount(book: Book): string | null {
  const banks = book.accounts.filter((a) => a.type === "bank");
  if (banks.length === 0) return null;
  const uses = new Map(banks.map((a) => [a.id, 0]));
  for (const e of book.events) {
    for (const key of ["accountId", "fromAccountId", "toAccountId"] as const) {
      const id = (e as unknown as Record<string, unknown>)[key];
      if (typeof id === "string" && uses.has(id)) uses.set(id, uses.get(id)! + 1);
    }
  }
  return [...banks].sort((a, b) => uses.get(b.id)! - uses.get(a.id)! || Number(b.id === "account-netbanking") - Number(a.id === "account-netbanking"))[0].id;
}

/** For one card line: the exact payment already recorded, or how to record it. Null when it isn't a payment. */
export function cardPaymentFor(
  row: Pick<StatementRow, "direction" | "rawDescription" | "amountMinor" | "transactionDate">,
  cardId: string,
  book: Book,
  taken: Set<string> = new Set(),
): { existingTransferId: string } | { classification: Classification } | null {
  if (row.direction !== "credit" || MONEY_BACK.test(row.rawDescription) || NOT_A_PAYMENT.test(row.rawDescription)) return null;
  const banks = new Set(book.accounts.filter((a) => a.type === "bank" || a.type === "cash").map((a) => a.id));

  // The same payment recorded from the bank side: same amount, a few days apart. Linked, not added.
  const transfer = book.events
    .filter(
      (e) =>
        e.type === "transfer" &&
        e.toAccountId === cardId &&
        e.amountMinor === row.amountMinor &&
        Math.abs(day(e.date) - day(row.transactionDate)) <= LINK_WINDOW_DAYS &&
        !taken.has(e.id),
    )
    .sort((a, b) => Math.abs(day(a.date) - day(row.transactionDate)) - Math.abs(day(b.date) - day(row.transactionDate)))[0];
  if (transfer) return { existingTransferId: transfer.id };

  // Paid from the account that usually pays this card, or else your main bank account: the one with the most
  // entries (empty placeholders such as "UPI" or "Debit card" are never picked over a real, used account).
  const usual = book.events.find((e) => e.type === "transfer" && e.toAccountId === cardId && banks.has(e.fromAccountId));
  const from = (usual?.type === "transfer" ? usual.fromAccountId : undefined) ?? mainBankAccount(book);

  return {
    classification: {
      source: "rule",
      eventType: "TRANSFER",
      category: null,
      merchant: null,
      person: null,
      counterAccountId: from,
      holding: null,
      confidence: from ? 0.95 : 0.6,
      reason: "Money in on a card statement that isn't a refund: you paying the card bill (not spending, not income).",
      alternatives: ["INCOME"],
    },
  };
}

/** Settles every bill-payment line of a card statement. Lines you decided yourself are left alone. Returns how many changed. */
export function settleCardPayments(rows: StatementRow[], cardId: string, book: Book): number {
  const taken = new Set<string>();
  let changed = 0;
  for (const r of rows) {
    if (r.decision?.by === "user" || r.status === "imported" || r.status === "matched_existing" || r.status === "already_imported" || r.status === "skipped") continue;
    const found = cardPaymentFor(r, cardId, book, taken);
    if (!found) continue;
    changed++;
    if ("existingTransferId" in found) {
      taken.add(found.existingTransferId);
      r.status = "matched_existing";
      r.eventId = found.existingTransferId;
      r.match = { kind: "existing_event", level: 1, eventId: found.existingTransferId, score: 1, reason: "This is your card bill payment, already recorded from your bank statement." };
    } else {
      r.classification = found.classification;
    }
  }
  return changed;
}
