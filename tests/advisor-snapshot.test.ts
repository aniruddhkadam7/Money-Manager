import { describe, expect, it } from "vitest";
import { buildSnapshot } from "@/lib/advisor/snapshot";
import { Scenario, rs } from "./helpers";

describe("the figures the AI CA answers from", () => {
  it("works out what you have, owe, spend and how long the money lasts", () => {
    const s = new Scenario();
    s.today = "2026-03-31";
    const bank = s.account({ name: "HDFC", type: "bank", openingBalanceMinor: rs(3_00_000) });
    const ravi = s.person("Ravi Kumar");
    // Three months: ₹60,000 salary, ₹20,000 rent (essential), ₹10,000 shopping (lifestyle).
    for (const m of ["01", "02", "03"]) {
      s.ok({ type: "income", date: `2026-${m}-01`, accountId: bank.id, amountMinor: rs(60_000), categoryId: "salary" });
      s.ok({ type: "expense", date: `2026-${m}-05`, accountId: bank.id, amountMinor: rs(20_000), categoryId: "rent" });
      s.ok({ type: "expense", date: `2026-${m}-10`, accountId: bank.id, amountMinor: rs(10_000), categoryId: "shopping" });
    }
    s.ok({ type: "borrow", date: "2026-03-15", personId: ravi.id, accountId: bank.id, amountMinor: rs(30_000) });

    const ledger = s.ledger;
    const snap = buildSnapshot({
      book: s.book,
      ledger,
      state: s.state(),
      today: s.today,
      report: (from, to) => s.report(from, to),
      categoryName: (id) => id,
      subscriptions: [],
      reminders: [],
    });

    // ₹3,00,000 + 3 × (₹60,000 − ₹30,000) + ₹30,000 borrowed.
    expect(snap.have.bankAndCash).toBe(4_20_000);
    expect(snap.owe.people).toEqual([expect.objectContaining({ name: "Ravi Kumar", owed: 30_000 })]);
    expect(snap.monthly.income).toBeGreaterThan(55_000);
    expect(snap.monthly.essentialSpending).toBeLessThan(snap.monthly.spending);
    expect(snap.monthly.lifestyleSpending).toBe(snap.monthly.spending - snap.monthly.essentialSpending);
    // About 20 months on essentials alone (₹4.2 lakh ÷ ~₹20,000), fewer at the current lifestyle.
    expect(snap.measures.monthsWithoutIncome!).toBeGreaterThan(15);
    expect(snap.measures.monthsWithoutIncomeAtCurrentLifestyle!).toBeLessThan(snap.measures.monthsWithoutIncome!);
    expect(snap.measures.savingsRatePercent!).toBeGreaterThan(40);
    expect(snap.history.at(-1)?.month).toBe("2026-03");
    // Where income came from, so salary can be named: by category and by payer, with the dates.
    expect(snap.history.at(-1)?.incomeByCategory).toEqual([{ category: "salary", amount: 60_000 }]);
    expect(snap.history.at(-1)?.incomeFrom).toEqual([{ payer: "salary", amount: 60_000, dates: ["2026-03-01"] }]);
    // Full records: each person's history, and every entry.
    expect(snap.peopleAllTime).toEqual([expect.objectContaining({ name: "Ravi Kumar", borrowed: 30_000, repaid: 0, stillOwe: 30_000 })]);
    expect(snap.entries.columns).toEqual(["date", "kind", "amount", "who", "category", "account", "reason"]);
    expect(snap.entries.rows).toHaveLength(10);
    expect(snap.entries.rows[0]).toEqual(["2026-03-15", "borrowed", 30_000, "Ravi Kumar", "", "HDFC", ""]);
    expect(snap.spendingByMonth.at(-1)?.byCategory).toEqual([{ category: "rent", amount: 20_000 }, { category: "shopping", amount: 10_000 }]);
  });
});
