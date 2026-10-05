import { merchantKey } from "./recurring";
import type { Book, EventDraft, FinancialEvent } from "./types";

/**
 * "You just changed this entry; there are others from the same merchant or person. Change those too?"
 * Only kinds that can be converted into each other without changing which way the money moved.
 */

type Convertible = Extract<FinancialEvent, { type: "expense" | "income" | "reimbursable_expense" | "lend" | "borrow" | "repayment_received" | "repayment_made" }>;

const MONEY_OUT = new Set(["expense", "reimbursable_expense", "lend", "repayment_made"]);
const MONEY_IN = new Set(["income", "borrow", "repayment_received"]);

const isConvertible = (e: FinancialEvent): e is Convertible => MONEY_OUT.has(e.type) || MONEY_IN.has(e.type);
const direction = (e: Convertible) => (MONEY_OUT.has(e.type) ? "out" : "in");

const personOf = (e: FinancialEvent) => ("personId" in e ? e.personId : undefined);
const categoryOf = (e: FinancialEvent) => ("categoryId" in e ? e.categoryId : undefined);

/** The target's kind, category and person, applied to another entry; its own amount, date, account and note are kept. */
export function retype(source: FinancialEvent, like: FinancialEvent): EventDraft | null {
  if (!isConvertible(source) || !isConvertible(like) || direction(source) !== direction(like)) return null;
  const base = { date: source.date, description: source.description, note: source.note, accountId: source.accountId, amountMinor: source.amountMinor };
  const personId = personOf(like) ?? personOf(source);
  const categoryId = categoryOf(like) ?? categoryOf(source);
  switch (like.type) {
    case "expense":
      return { type: "expense", ...base, categoryId: categoryId ?? "other" };
    case "income":
      return { type: "income", ...base, categoryId: categoryId ?? "other-income" };
    case "reimbursable_expense":
      return personId ? { type: "reimbursable_expense", ...base, categoryId: categoryId ?? "other", personId } : null;
    case "lend":
    case "borrow":
      return personId ? { type: like.type, ...base, personId } : null;
    case "repayment_received":
    case "repayment_made":
      return personId ? { type: like.type, ...base, personId, predatesRecords: true } : null;
  }
}

const sameShape = (a: FinancialEvent, b: FinancialEvent) => a.type === b.type && categoryOf(a) === categoryOf(b) && personOf(a) === personOf(b);

export interface SimilarMatch {
  event: FinancialEvent;
  draft: EventDraft;
}

/** Other entries with the same merchant (by name) or the same person that would change to match `edited`. */
export function findSimilar(book: Book, edited: FinancialEvent): SimilarMatch[] {
  if (!isConvertible(edited)) return [];
  const key = edited.description?.trim() ? merchantKey(edited.description).key : "";
  const person = personOf(edited);
  const out: SimilarMatch[] = [];
  for (const e of book.events) {
    if (e.id === edited.id || !isConvertible(e) || direction(e) !== direction(edited)) continue;
    const sameMerchant = key !== "" && !!e.description?.trim() && merchantKey(e.description).key === key;
    const samePerson = !!person && personOf(e) === person;
    if (!sameMerchant && !samePerson) continue;
    if (sameShape(e, edited)) continue;
    const draft = retype(e, edited);
    if (draft) out.push({ event: e, draft });
  }
  return out.sort((a, b) => (a.event.date < b.event.date ? 1 : -1));
}
