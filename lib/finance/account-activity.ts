import type { Book } from "./types";

/**
 * What happened in one account between two dates, in the words a bank or card app uses.
 * A card bill paid from the bank is a "bill" on the bank and a "payment" on the card, never "spent":
 * the spending itself is the card's purchases, so counting the bill too would count it twice.
 */
export interface AccountActivity {
  /** Purchases paid from this account (your whole payment for split bills). */
  spentMinor: number;
  /** Card and loan bills paid from this (bank) account. */
  billsPaidMinor: number;
  /** Money that came into this account: income, refunds, borrowing, repayments, transfers in, sales. */
  receivedMinor: number;
  /** Payments made to this card or loan. */
  paymentsInMinor: number;
}

export function accountActivity(book: Book, accountId: string, from: string, to: string): AccountActivity {
  const typeOf = new Map(book.accounts.map((a) => [a.id, a.type]));
  const isDebt = (id: string) => typeOf.get(id) === "credit_card" || typeOf.get(id) === "loan";
  const own = typeOf.get(accountId);
  const out: AccountActivity = { spentMinor: 0, billsPaidMinor: 0, receivedMinor: 0, paymentsInMinor: 0 };
  for (const e of book.events) {
    if (e.date < from || e.date > to) continue;
    switch (e.type) {
      case "expense":
      case "reimbursable_expense":
        if (e.accountId === accountId) out.spentMinor += e.amountMinor;
        break;
      case "split_expense":
        if (e.accountId === accountId) out.spentMinor += e.totalMinor;
        break;
      case "borrow":
        // Owed from before records began: nothing arrived in the account.
        if (e.accountId === accountId && !e.predatesRecords) out.receivedMinor += e.amountMinor;
        break;
      case "income":
      case "repayment_received":
        if (e.accountId === accountId) out.receivedMinor += e.amountMinor;
        break;
      case "sell_investment":
        if (e.toAccountId === accountId) out.receivedMinor += e.proceedsMinor;
        break;
      case "transfer":
        if (e.fromAccountId === accountId && isDebt(e.toAccountId)) out.billsPaidMinor += e.amountMinor;
        if (e.toAccountId === accountId) {
          if (own === "credit_card" || own === "loan") out.paymentsInMinor += e.amountMinor;
          else out.receivedMinor += e.amountMinor;
        }
        break;
    }
  }
  return out;
}
