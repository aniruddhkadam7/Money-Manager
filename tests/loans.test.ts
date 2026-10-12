import { describe, expect, it } from "vitest";
import { accountIdsUsedBy, ensureLoan } from "@/lib/finance/book-ops";
import { rs, Scenario, startingScenario, testClock } from "./helpers";

const owedOn = (s: Scenario, id: string) => s.state().accounts.find((a) => a.account.id === id)!.balanceMinor;

describe("bank loans", () => {
  it("taking a loan puts the money in the bank and adds what's owed, leaving net worth and income alone", () => {
    const { s, hdfc, loan } = startingScenario();
    const before = s.state().netWorthMinor;
    s.ok({ type: "loan_taken", date: "2026-03-01", fromAccountId: loan.id, toAccountId: hdfc.id, amountMinor: rs(500_000) });

    expect(owedOn(s, hdfc.id)).toBe(rs(1_000_000));
    expect(owedOn(s, loan.id)).toBe(rs(600_000));
    expect(s.state().netWorthMinor).toBe(before);
    expect(s.report().incomeMinor).toBe(0);
  });

  it("an EMI pays the loan down by its principal and counts only its interest as spending", () => {
    const { s, hdfc, loan } = startingScenario();
    s.ok({
      type: "emi_payment",
      date: "2026-03-05",
      fromAccountId: hdfc.id,
      toAccountId: loan.id,
      amountMinor: rs(10_000),
      interestMinor: rs(800),
      categoryId: "emi",
    });

    expect(owedOn(s, hdfc.id)).toBe(rs(490_000));
    expect(owedOn(s, loan.id)).toBe(rs(90_800));
    const r = s.report();
    expect(r.expensesMinor).toBe(rs(800));
    expect(r.expensesByCategory).toEqual([{ categoryId: "emi", amountMinor: rs(800) }]);
    // All ₹10,000 left the bank: ₹9,200 as debt payment, ₹800 as spending.
    expect(r.cashFlow.debt_payment.outflowMinor).toBe(rs(9_200));
    expect(r.cashFlow.expense.outflowMinor).toBe(rs(800));
  });

  it("allows an all-interest EMI, and refuses interest above the EMI or a non-loan account", () => {
    const { s, hdfc, loan } = startingScenario();
    const base = { type: "emi_payment" as const, date: "2026-03-05", fromAccountId: hdfc.id, amountMinor: rs(1_000), categoryId: "emi" };
    expect(s.record({ ...base, toAccountId: loan.id, interestMinor: rs(1_000) }).ok).toBe(true);
    expect(owedOn(s, loan.id)).toBe(rs(100_000));

    const tooMuch = s.record({ ...base, toAccountId: loan.id, interestMinor: rs(1_001) });
    expect(tooMuch.ok).toBe(false);
    if (!tooMuch.ok) expect(tooMuch.issues[0].code).toBe("interest_exceeds_emi");

    const notALoan = s.record({ ...base, toAccountId: hdfc.id, interestMinor: 0 });
    expect(notALoan.ok).toBe(false);
  });

  it("finds or adds a loan by name, but never reuses another kind of account's name", () => {
    const { s, hdfc, loan } = startingScenario();
    const clock = testClock();
    expect(ensureLoan(s.book, "home LOAN", "2026-03-01", clock)!.account.id).toBe(loan.id);

    const added = ensureLoan(s.book, "Car loan", "2026-03-01", clock)!;
    expect(added.account).toMatchObject({ name: "Car loan", type: "loan", openingBalanceMinor: 0, openedOn: "2026-03-01" });
    expect(added.book.accounts).toHaveLength(3);

    expect(ensureLoan(s.book, hdfc.name, "2026-03-01", clock)).toBeNull();
  });

  it("counts both accounts as used, so neither can be deleted out from under the entry", () => {
    const { s, hdfc, loan } = startingScenario();
    const emi = s.ok({ type: "emi_payment", date: "2026-03-05", fromAccountId: hdfc.id, toAccountId: loan.id, amountMinor: rs(1_000), interestMinor: 0, categoryId: "emi" });
    expect(accountIdsUsedBy(emi)).toEqual([hdfc.id, loan.id]);
  });
});
