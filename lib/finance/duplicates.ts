import type { Book, FinancialEvent } from "./types";

/**
 * Entries that came from a bank statement and look like the same line imported twice (for example the
 * same statement uploaded again as a different file). Only entries from DIFFERENT imports are compared:
 * two identical lines inside one statement are two real transactions, because the bank printed both.
 */
export interface DuplicateGroup {
  key: string;
  /** The entries to keep (from the earliest import). */
  keep: FinancialEvent[];
  /** The same lines again, from later imports. */
  extras: FinancialEvent[];
}

/**
 * What makes two entries "the same line": type, date, amount, person, category and accounts. The bank's
 * wording is left out on purpose: the same line reads differently in a PDF, a CSV and a summary statement.
 */
export const statementShape = (e: Pick<FinancialEvent, "type" | "date">): string => {
  const person = "personId" in e ? e.personId : "";
  const category = "categoryId" in e ? e.categoryId : "";
  const accounts = [("accountId" in e && e.accountId) || "", ("fromAccountId" in e && e.fromAccountId) || "", ("toAccountId" in e && e.toAccountId) || "", ("holdingId" in e && e.holdingId) || ""].join(",");
  const amount = "amountMinor" in e ? e.amountMinor : "proceedsMinor" in e ? e.proceedsMinor : "totalMinor" in e ? e.totalMinor : 0;
  return [e.type, e.date, amount, person, category, accounts].join("|");
};

export function findImportedDuplicates(book: Book): DuplicateGroup[] {
  const groups = new Map<string, FinancialEvent[]>();
  for (const e of book.events) {
    if (!e.sources?.some((s) => s.kind === "statement" && s.role === "created")) continue;
    const key = statementShape(e);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  const out: DuplicateGroup[] = [];
  for (const [key, events] of groups) {
    const importOf = (e: FinancialEvent) => e.sources!.find((s) => s.role === "created")!.importId;
    const byImport = new Map<string, FinancialEvent[]>();
    for (const e of events) byImport.set(importOf(e), [...(byImport.get(importOf(e)) ?? []), e]);
    if (byImport.size < 2) continue;

    // Keep the import that has the most of them (earliest on a tie); everything from the others is a repeat.
    const ordered = [...byImport.values()].sort((a, b) => b.length - a.length || a[0].createdAt.localeCompare(b[0].createdAt));
    const [keep, ...rest] = ordered;
    out.push({ key, keep, extras: rest.flat() });
  }
  return out.sort((a, b) => (a.keep[0].date < b.keep[0].date ? 1 : -1));
}
