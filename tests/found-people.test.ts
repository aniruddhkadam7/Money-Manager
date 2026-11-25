import { describe, expect, it } from "vitest";
import { findPeopleInEntries } from "@/lib/finance/found-people";
import type { Book, FinancialEvent } from "@/lib/finance/types";

const base = { createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
let n = 0;
const expense = (description: string, narration?: string, amountMinor = 10_000, date = "2026-03-01"): FinancialEvent => ({
  ...base,
  id: `e${++n}`,
  type: "expense",
  date,
  description,
  accountId: "bank",
  amountMinor,
  categoryId: "other",
  ...(narration ? { sources: [{ kind: "statement", importId: "i", rowId: `r${n}`, filename: "s.pdf", line: n, narration, role: "created" }] } : {}),
});
const income = (description: string, narration: string, amountMinor: number): FinancialEvent => ({ ...(expense(description, narration, amountMinor) as object), type: "income" }) as FinancialEvent;

const book = (events: FinancialEvent[], people: Book["people"] = []): Book => ({ accounts: [], people, events });

describe("findPeopleInEntries", () => {
  it("finds a person paid by UPI who isn't in People, adding up every entry", () => {
    const found = findPeopleInEntries(
      book([
        expense("Rahul Patil", "UPI/403821907312/RAHUL PATIL/rahulpatil@okaxis", 50_000),
        expense("Rahul Patil", "UPI/403821907399/RAHUL PATIL/rahulpatil@okaxis", 20_000, "2026-04-02"),
        income("Rahul Patil", "UPI/403821907400/RAHUL PATIL/rahulpatil@okaxis", 5_000),
      ]),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: "Rahul Patil", entries: 3, paidMinor: 70_000, receivedMinor: 5_000, lastDate: "2026-04-02" });
  });

  it("finds a name in a typed description like “Paid to Priya Shah for dinner”", () => {
    expect(findPeopleInEntries(book([expense("Paid to Priya Shah for dinner")])).map((p) => p.name)).toEqual(["Priya Shah"]);
  });

  it("leaves out merchants, plain descriptions and people already in the list", () => {
    const found = findPeopleInEntries(
      book(
        [
          expense("Swiggy", "UPI/403821907312/SWIGGY/swiggyupi@icici"),
          expense("Groceries"),
          expense("Govindraj Ing", "UPI/403821907312/GOVINDRAJ ING/9876543210@ybl"),
        ],
        [{ id: "p1", name: "Govindraj Ingle", createdAt: base.createdAt }],
      ),
    );
    expect(found).toEqual([]);
  });

  it("hides names marked as not a person", () => {
    expect(findPeopleInEntries(book([expense("Paid to Priya Shah")]), new Set(["priya shah"]))).toEqual([]);
  });
});
