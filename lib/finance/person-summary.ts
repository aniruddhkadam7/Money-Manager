import { personIdsUsedBy } from "./book-ops";
import type { FinancialEvent, Person } from "./types";

/** The words of a name worth matching on (initials and very short words are left out). */
const nameWords = (name: string): string[] =>
  name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3);

/**
 * An entry that isn't tied to the person but names them: a bank line like "UPI/GOVINDRAJ INGLE/…" saved as
 * spending, income or a transfer. Every word of their name must appear, so "Raj" alone doesn't match "Rajesh".
 */
export function mentionsPerson(e: FinancialEvent, name: string): boolean {
  if (e.type !== "expense" && e.type !== "income" && e.type !== "transfer") return false;
  const words = nameWords(name);
  if (words.length === 0 || !e.description) return false;
  const said = new Set(nameWords(e.description));
  return words.every((w) => said.has(w));
}

/** Everything with this person: entries made with them, and payments that name them. */
export function involvesPerson(e: FinancialEvent, person: Pick<Person, "id" | "name">): boolean {
  return personIdsUsedBy(e).includes(person.id) || mentionsPerson(e, person.name);
}

export interface PersonSummary {
  entries: number;
  lentMinor: number;
  borrowedMinor: number;
  /** Repayments they made to you, and you to them. */
  theyRepaidMinor: number;
  youRepaidMinor: number;
  splits: { count: number; billsMinor: number; theirShareMinor: number };
  /** Spending you covered for them, to be paid back. */
  paidForThemMinor: number;
  /** Payments that only name them (from a bank statement, say). */
  paidToThemMinor: number;
  receivedFromThemMinor: number;
  /** What the shared spending was on: category id and the amount that was theirs, largest first. */
  byCategory: { categoryId: string; amountMinor: number }[];
}

/** Every kind of money that went between you and one person, added up. */
export function personSummary(events: FinancialEvent[], person: Pick<Person, "id" | "name">): PersonSummary {
  const s: PersonSummary = {
    entries: 0,
    lentMinor: 0,
    borrowedMinor: 0,
    theyRepaidMinor: 0,
    youRepaidMinor: 0,
    splits: { count: 0, billsMinor: 0, theirShareMinor: 0 },
    paidForThemMinor: 0,
    paidToThemMinor: 0,
    receivedFromThemMinor: 0,
    byCategory: [],
  };
  const categories = new Map<string, number>();
  const onCategory = (id: string, amount: number) => categories.set(id, (categories.get(id) ?? 0) + amount);

  for (const e of events) {
    if (!involvesPerson(e, person)) continue;
    s.entries += 1;
    switch (e.type) {
      case "lend":
        s.lentMinor += e.amountMinor;
        break;
      case "borrow":
        s.borrowedMinor += e.amountMinor;
        break;
      case "repayment_received":
        s.theyRepaidMinor += e.amountMinor;
        break;
      case "repayment_made":
        s.youRepaidMinor += e.amountMinor;
        break;
      case "split_expense": {
        const share = e.shares.filter((x) => x.personId === person.id).reduce((t, x) => t + x.amountMinor, 0);
        s.splits.count += 1;
        s.splits.billsMinor += e.totalMinor;
        s.splits.theirShareMinor += share;
        onCategory(e.categoryId, share);
        break;
      }
      case "reimbursable_expense":
        s.paidForThemMinor += e.amountMinor;
        onCategory(e.categoryId, e.amountMinor);
        break;
      case "expense":
        s.paidToThemMinor += e.amountMinor;
        onCategory(e.categoryId, e.amountMinor);
        break;
      case "transfer":
        s.paidToThemMinor += e.amountMinor;
        break;
      case "income":
        s.receivedFromThemMinor += e.amountMinor;
        break;
    }
  }
  s.byCategory = [...categories]
    .filter(([, amount]) => amount > 0)
    .map(([categoryId, amountMinor]) => ({ categoryId, amountMinor }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
  return s;
}
