import { idOf } from "./engine";
import { paymentMethodOf } from "./payment-method";
import { isAssetAccount, type Account, type Book, type FinancialEvent, type LedgerEntry } from "./types";

/**
 * Plain-language descriptions of events and their effects. This is what makes
 * the ledger trustworthy to a person: opening an event shows exactly what changed.
 */

export type EffectKind = "balance" | "debt" | "owed_to_you" | "you_owe" | "spending" | "income" | "gain";

export interface Effect {
  kind: EffectKind;
  label: string;
  /** Change to the number shown by `label` (e.g. +20,000 to "You owe Rahul"). */
  deltaMinor: number;
}

export interface EntryEffects {
  effects: Effect[];
  /** How this entry changed net worth. Zero for loans, transfers, investing, lending... */
  netWorthDeltaMinor: number;
}

export interface Describer {
  title(event: FinancialEvent): string;
  subtitle(event: FinancialEvent): string;
  effects(entry: LedgerEntry): EntryEffects;
}

export function makeDescriber(book: Book, categoryName: (id: string) => string): Describer {
  const accounts = new Map<string, Account>(book.accounts.map((a) => [a.id, a]));
  const people = new Map(book.people.map((p) => [p.id, p.name]));
  const acct = (id: string) => accounts.get(id)?.name ?? "a deleted account";
  const who = (id: string) => people.get(id) ?? "someone";
  /**
   * "UPI from Kotak Mahindra Bank", "Card · HDFC Credit Card", "from Cash": how it was paid, when the bank line
   * says, then which account. A card or cash account already says how, so it isn't repeated.
   */
  const via = (e: FinancialEvent, id: string, word: "from" | "into") => {
    const account = accounts.get(id);
    const method = paymentMethodOf(e, account);
    if (!method || account?.type === "credit_card" || account?.type === "cash") return `${word} ${acct(id)}`;
    return `${method} ${word} ${acct(id)}`;
  };
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const title = (e: FinancialEvent): string => {
    switch (e.type) {
      case "expense":
        return e.description || categoryName(e.categoryId);
      case "income":
        return e.description || `${categoryName(e.categoryId)} received`;
      case "transfer": {
        const to = accounts.get(e.toAccountId);
        return to && !isAssetAccount(to.type) ? `Paid ${to.name}` : `Moved to ${acct(e.toAccountId)}`;
      }
      case "lend":
        return `Lent to ${who(e.personId)}`;
      case "borrow":
        return `Borrowed from ${who(e.personId)}`;
      case "repayment_received":
        return `${who(e.personId)} paid you back`;
      case "repayment_made":
        return `Paid back ${who(e.personId)}`;
      case "split_expense":
        return e.description || `Split ${categoryName(e.categoryId).toLowerCase()} bill`;
      case "reimbursable_expense":
        return e.description || `${categoryName(e.categoryId)} (to be reimbursed)`;
      case "invest":
        return `Invested in ${acct(e.holdingId)}`;
      case "sell_investment":
        return `Sold ${acct(e.holdingId)}`;
      case "update_valuation":
        return `${acct(e.holdingId)} value updated`;
    }
  };

  const subtitle = (e: FinancialEvent): string => {
    switch (e.type) {
      case "expense":
        return `${categoryName(e.categoryId)} · ${via(e, e.accountId, "from")}`;
      case "income":
        return `${categoryName(e.categoryId)} · ${via(e, e.accountId, "into")}`;
      case "transfer":
        return cap(via(e, e.fromAccountId, "from"));
      case "lend":
      case "repayment_made":
        if (e.type === "lend" && e.predatesRecords) return "From before you started tracking";
        return cap(via(e, e.accountId, "from"));
      case "borrow":
      case "repayment_received":
        if (e.type === "borrow" && e.predatesRecords) return "From before you started tracking";
        return cap(via(e, e.accountId, "into"));
      case "split_expense": {
        const others = e.shares.reduce((t, s) => t + s.amountMinor, 0);
        return `${categoryName(e.categoryId)} · your share ${formatRupees(e.totalMinor - others)} of ${formatRupees(e.totalMinor)}`;
      }
      case "reimbursable_expense":
        return `${who(e.personId)} will reimburse you · ${via(e, e.accountId, "from")}`;
      case "invest":
        return `From ${acct(e.fromAccountId)}`;
      case "sell_investment":
        return `Into ${acct(e.toAccountId)}`;
      case "update_valuation":
        return `Now worth ${formatRupees(e.valueMinor)}`;
    }
  };

  const effects = (entry: LedgerEntry): EntryEffects => {
    const out: Effect[] = [];
    let gain = 0;
    let netWorthDelta = 0;

    for (const p of entry.postings) {
      const id = idOf(p.ledger);
      if (p.ledger.startsWith("acct:")) {
        const a = accounts.get(id);
        if (!a) continue;
        if (isAssetAccount(a.type)) out.push({ kind: "balance", label: a.name, deltaMinor: p.amountMinor });
        else out.push({ kind: "debt", label: `${a.name} (amount owed)`, deltaMinor: -p.amountMinor });
      } else if (p.ledger.startsWith("recv:")) {
        out.push({ kind: "owed_to_you", label: `${who(id)} owes you`, deltaMinor: p.amountMinor });
      } else if (p.ledger.startsWith("pay:")) {
        out.push({ kind: "you_owe", label: `You owe ${who(id)}`, deltaMinor: -p.amountMinor });
      } else if (p.ledger.startsWith("exp:")) {
        out.push({ kind: "spending", label: `${categoryName(id)} spending`, deltaMinor: p.amountMinor });
        netWorthDelta -= p.amountMinor;
      } else if (p.ledger.startsWith("inc:")) {
        out.push({ kind: "income", label: `${categoryName(id)} income`, deltaMinor: -p.amountMinor });
        netWorthDelta -= p.amountMinor;
      } else if (p.ledger.startsWith("gain:")) {
        gain -= p.amountMinor;
        netWorthDelta -= p.amountMinor;
      } else {
        netWorthDelta -= p.amountMinor; // opening-balance equity
      }
    }
    if (gain !== 0) out.push({ kind: "gain", label: gain > 0 ? "Investment gain" : "Investment loss", deltaMinor: gain });

    return { effects: out, netWorthDeltaMinor: netWorthDelta };
  };

  return { title, subtitle, effects };
}

export function formatRupees(minor: number): string {
  const abs = Math.abs(minor);
  const text = `₹${(abs / 100).toLocaleString("en-IN", { minimumFractionDigits: abs % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
  return minor < 0 ? `−${text}` : text;
}
