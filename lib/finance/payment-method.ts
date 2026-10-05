import type { Account, FinancialEvent } from "./types";

/**
 * How a payment was made, as opposed to which account it came from: a UPI payment, a card swipe and a
 * NEFT transfer can all leave the same bank account. Read from the bank's own wording on the statement
 * line the entry came from; entries typed in by hand have no method.
 */
export type PaymentMethod = "UPI" | "Card" | "NEFT" | "IMPS" | "RTGS" | "ATM" | "Auto-debit" | "Cheque" | "Cash" | "Wallet";

const BY_CODE: Record<string, PaymentMethod> = {
  UPI: "UPI",
  NEFT: "NEFT",
  IMPS: "IMPS",
  RTGS: "RTGS",
  ATM: "ATM",
  NWD: "ATM",
  POS: "Card",
  ACH: "Auto-debit",
  NACH: "Auto-debit",
  ECS: "Auto-debit",
  SI: "Auto-debit",
  CHQ: "Cheque",
  CHEQUE: "Cheque",
};

/** The method a bank narration names, if any: "UPI/RAJESH/…" -> UPI, "POS 4321 DMART" -> Card. */
export function methodFromNarration(text: string | undefined): PaymentMethod | null {
  if (!text) return null;
  const t = text.toUpperCase();
  const first = t.trim().split(/[\s/\-|:]+/)[0]?.replace(/[^A-Z]/g, "") ?? "";
  if (BY_CODE[first]) return BY_CODE[first];
  const m = /\b(UPI|NEFT|IMPS|RTGS|ATM|NWD|POS|NACH|ACH|ECS|CHQ|CHEQUE)\b/.exec(t);
  if (m) return BY_CODE[m[1]];
  if (/@(ybl|okaxis|oksbi|okhdfcbank|okicici|paytm|ibl|axl|apl|upi)\b/i.test(text)) return "UPI";
  if (/\b(DEBIT CARD|DC |VISA|MASTERCARD|RUPAY)\b/.test(t)) return "Card";
  return null;
}

/**
 * The method for an entry: what its statement line says, or what its account implies (anything paid from
 * a credit card was paid by card; a cash or wallet account is cash). Null when nothing says.
 */
export function paymentMethodOf(e: FinancialEvent, account: Pick<Account, "type"> | undefined): PaymentMethod | null {
  if (account?.type === "credit_card") return "Card";
  for (const s of e.sources ?? []) {
    const m = methodFromNarration(s.narration);
    if (m) return m;
  }
  if (account?.type === "cash") return "Cash";
  return null;
}
