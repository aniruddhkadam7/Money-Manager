import { describe, expect, it } from "vitest";
import { matchRefunds } from "@/lib/finance/state";
import { rs, startingScenario } from "./helpers";

describe("refunds come off the purchase they gave back", () => {
  it("pairs an Amazon refund with the order, even when the bank shortens the name", () => {
    const { s, hdfc } = startingScenario();
    s.ok({ type: "expense", date: "2026-02-07", description: "Amazon India", accountId: hdfc.id, amountMinor: rs(15_206), categoryId: "shopping" });
    s.ok({ type: "expense", date: "2026-02-08", description: "Swiggy", accountId: hdfc.id, amountMinor: rs(500), categoryId: "food" });
    s.ok({ type: "income", date: "2026-02-18", description: "Amazon Indi", accountId: hdfc.id, amountMinor: rs(15_206), categoryId: "refund" });

    const r = s.report("2026-02-01", "2026-02-28");
    expect(r.incomeMinor).toBe(0);
    expect(r.expensesMinor).toBe(rs(500));
    expect(r.expensesByCategory.find((c) => c.categoryId === "shopping")?.amountMinor ?? 0).toBe(0);
    expect(r.refundsMinor).toBe(rs(15_206));
    expect(matchRefunds(s.book).size).toBe(1);
  });

  it("keeps an unmatched refund off the total only, and never pairs a reimbursement", () => {
    const { s, hdfc } = startingScenario();
    s.ok({ type: "expense", date: "2026-02-07", description: "Zomato", accountId: hdfc.id, amountMinor: rs(800), categoryId: "food" });
    s.ok({ type: "income", date: "2026-02-10", description: "Flipkart", accountId: hdfc.id, amountMinor: rs(300), categoryId: "refund" });
    s.ok({ type: "income", date: "2026-02-11", description: "Zomato", accountId: hdfc.id, amountMinor: rs(200), categoryId: "reimbursement" });

    const r = s.report("2026-02-01", "2026-02-28");
    expect(r.expensesMinor).toBe(rs(300));
    expect(r.expensesByCategory.find((c) => c.categoryId === "food")?.amountMinor).toBe(rs(800));
    expect(matchRefunds(s.book).size).toBe(0);
  });
});
