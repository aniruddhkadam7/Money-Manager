import { describe, expect, it } from "vitest";
import { involvesPerson, mentionsPerson, personSummary } from "@/lib/finance/person-summary";
import type { FinancialEvent } from "@/lib/finance/types";

const t = "2026-10-01T00:00:00Z";
const ev = (id: string, e: Record<string, unknown>) => ({ id, date: "2026-10-01", createdAt: t, updatedAt: t, ...e }) as unknown as FinancialEvent;
const govind = { id: "g", name: "Govindraj Ingle" };

describe("everything with one person", () => {
  it("finds payments that only name them, by every word of the name", () => {
    expect(mentionsPerson(ev("a", { type: "expense", description: "UPI/GOVINDRAJ INGLE/okaxis", accountId: "k", amountMinor: 100, categoryId: "food" }), govind.name)).toBe(true);
    expect(mentionsPerson(ev("b", { type: "expense", description: "Govindraj Patil", accountId: "k", amountMinor: 100, categoryId: "food" }), govind.name)).toBe(false);
    // A loan with someone else that happens to name them is that other person's.
    expect(mentionsPerson(ev("c", { type: "lend", description: "Govindraj Ingle", personId: "s", accountId: "k", amountMinor: 100 }), govind.name)).toBe(false);
  });

  it("adds up lending, splits, spending for them and named payments", () => {
    const events = [
      ev("l", { type: "lend", personId: "g", accountId: "k", amountMinor: 50000 }),
      ev("r", { type: "repayment_received", personId: "g", accountId: "k", amountMinor: 20000 }),
      ev("s", { type: "split_expense", accountId: "k", totalMinor: 57000, categoryId: "food", shares: [{ personId: "g", amountMinor: 28500 }] }),
      ev("x", { type: "split_expense", accountId: "k", totalMinor: 9000, categoryId: "travel", shares: [{ personId: "s", amountMinor: 4500 }] }),
      ev("p", { type: "reimbursable_expense", personId: "g", accountId: "k", amountMinor: 3000, categoryId: "travel" }),
      ev("u", { type: "expense", description: "UPI GOVINDRAJ INGLE", accountId: "k", amountMinor: 1000, categoryId: "food" }),
    ];
    expect(events.filter((e) => involvesPerson(e, govind)).map((e) => e.id)).toEqual(["l", "r", "s", "p", "u"]);
    const s = personSummary(events, govind);
    expect(s.entries).toBe(5);
    expect(s.lentMinor).toBe(50000);
    expect(s.theyRepaidMinor).toBe(20000);
    expect(s.splits).toEqual({ count: 1, billsMinor: 57000, theirShareMinor: 28500 });
    expect(s.paidForThemMinor).toBe(3000);
    expect(s.paidToThemMinor).toBe(1000);
    expect(s.byCategory).toEqual([
      { categoryId: "food", amountMinor: 29500 },
      { categoryId: "travel", amountMinor: 3000 },
    ]);
  });
});
