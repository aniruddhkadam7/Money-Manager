import type { Book, FinancialEvent } from "./types";

/**
 * Words on a bank line that mean "paying a credit card bill": the card itself, or the apps people pay it
 * through (CRED is run by Dreamplug, hence "Dreamplug Serv" on UPI lines).
 */
export const CARD_BILL_TEXT =
  /\b(credit card|cc ?payment|card ?payment|cc ?bill|card ?bill|cred|cred ?club|dreamplug|payment on cred|billdesk.*card|autopay.*card|onecard|one card|slice ?card|sbi ?card|sbicard|hdfc ?card|icici ?card|axis ?card|kotak ?card|amex|american express|bob ?card|rbl ?card|au ?card|idfc ?first ?card)\b/i;

const lineText = (e: FinancialEvent) => [e.description, e.note, ...(e.sources ?? []).map((s) => s.narration)].filter(Boolean).join(" ");

/**
 * Card bill payments recorded as ordinary spending from a bank or cash account (before they were
 * recognised): they make the card look unpaid and count the same money as spending twice.
 */
export function billPaymentsRecordedAsSpending(book: Book): FinancialEvent[] {
  const moneyAccounts = new Set(book.accounts.filter((a) => a.type === "bank" || a.type === "cash").map((a) => a.id));
  return book.events.filter((e) => e.type === "expense" && moneyAccounts.has(e.accountId) && CARD_BILL_TEXT.test(lineText(e)));
}

export interface CardSpend {
  /** Put on credit cards in the period: purchases charged to a card, less refunds and cashback back onto it. */
  spentMinor: number;
  /** Paid towards the cards in the period (bill payments from a bank or cash account). */
  paidMinor: number;
  byCard: { accountId: string; name: string; spentMinor: number; paidMinor: number }[];
}

/**
 * What went on credit cards between two dates (inclusive). This is part of total spending, not on top
 * of it: the same purchases are already in "Spent"; this says how much of it was by card.
 */
export function cardSpending(book: Book, from: string, to: string): CardSpend {
  const cards = new Map(book.accounts.filter((a) => a.type === "credit_card").map((a) => [a.id, { accountId: a.id, name: a.name, spentMinor: 0, paidMinor: 0 }]));
  for (const e of book.events) {
    if (e.date < from || e.date > to) continue;
    if (e.type === "transfer") {
      const card = cards.get(e.toAccountId);
      if (card) card.paidMinor += e.amountMinor;
      continue;
    }
    if (!("accountId" in e)) continue;
    const card = cards.get(e.accountId);
    if (!card) continue;
    if (e.type === "expense" || e.type === "reimbursable_expense") card.spentMinor += e.amountMinor;
    else if (e.type === "split_expense") card.spentMinor += e.totalMinor;
    else if (e.type === "income") card.spentMinor -= e.amountMinor;
  }
  const byCard = [...cards.values()];
  return {
    spentMinor: byCard.reduce((t, c) => t + c.spentMinor, 0),
    paidMinor: byCard.reduce((t, c) => t + c.paidMinor, 0),
    byCard,
  };
}
