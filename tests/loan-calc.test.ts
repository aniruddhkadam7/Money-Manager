import { describe, expect, it } from "vitest";
import { amortize, calcEmi, emiDate, loanPlan, loanProgress, plannedOwedOn } from "@/lib/finance/loan";
import type { Account, Book, LoanTerms } from "@/lib/finance/types";

const t = "2026-01-01T00:00:00Z";
// ₹10 lakh at 9% for 20 years: the textbook EMI is ₹8,997.
const home: LoanTerms = { principalMinor: 10_00_000_00, annualRateBps: 900, tenureMonths: 240, firstEmiDate: "2026-01-05" };

describe("loan calculator", () => {
  it("works out the EMI as banks do, in whole rupees", () => {
    expect(calcEmi(10_00_000_00, 900, 240)).toBe(8_997_00);
    expect(calcEmi(1_20_000_00, 0, 12)).toBe(10_000_00);
  });

  it("schedules every EMI, ending at exactly zero", () => {
    const plan = loanPlan(home);
    expect(plan.rows[0]).toMatchObject({ n: 1, date: "2026-01-05", interestMinor: 7_500_00, principalMinor: 1_497_00 });
    expect(plan.rows.at(-1)!.balanceMinor).toBe(0);
    expect(plan.months).toBe(240);
    expect(plan.totalPaidMinor - home.principalMinor).toBe(plan.totalInterestMinor);
    expect(plan.lastEmiDate).toBe("2045-12-05");
  });

  it("keeps the day of the month, on the last day of shorter months", () => {
    const t31 = { ...home, firstEmiDate: "2026-01-31" };
    expect(emiDate(t31, 2)).toBe("2026-02-28");
    expect(emiDate(t31, 3)).toBe("2026-03-31");
  });

  it("a prepayment shortens what's left", () => {
    const full = amortize(home);
    const after = amortize(home, full[11].balanceMinor - 1_00_000_00, 13);
    expect(after.length).toBeLessThan(full.length - 12);
  });

  it("counts EMIs due before tracking began, plus the ones recorded", () => {
    const loan: Account = { id: "L", name: "Home loan", type: "loan", openingBalanceMinor: plannedOwedOn(home, "2026-07-01"), openedOn: "2026-07-01", loanTerms: home, createdAt: t };
    const book: Book = {
      accounts: [loan],
      people: [],
      events: [
        { id: "e1", type: "emi_payment", date: "2026-07-05", fromAccountId: "B", toAccountId: "L", amountMinor: 8_997_00, interestMinor: 7_400_00, categoryId: "emi", createdAt: t, updatedAt: t },
      ],
    } as unknown as Book;
    const p = loanProgress(loan, home, book, loan.openingBalanceMinor - (8_997_00 - 7_400_00));
    expect(p.emisPaid).toBe(7);
    expect(p.next!.n).toBe(8);
    expect(p.next!.date).toBe("2026-08-05");
    expect(p.emisLeft).toBe(240 - 7);
  });
});

describe("EMI reminders", () => {
  it("lists a loan's next EMI a week ahead, and keeps it once overdue", async () => {
    const { upcomingBills } = await import("@/lib/finance/reminders");
    const book = { accounts: [], people: [], events: [] } as unknown as Book;
    const emi = { accountId: "L", name: "Home loan", n: 8, dueDate: "2026-08-05", amountMinor: 8_997_00 };
    const soon = upcomingBills(book, [], [], "2026-08-01", { emis: [emi] });
    expect(soon).toMatchObject([{ kind: "emi", title: "Home loan EMI", days: 4, amountMinor: 8_997_00, accountId: "L" }]);
    expect(upcomingBills(book, [], [], "2026-07-20", { emis: [emi] })).toEqual([]);
    expect(upcomingBills(book, [], [], "2026-08-10", { emis: [emi] })[0].days).toBe(-5);
  });
});

describe("loan purpose", () => {
  it("uses the one picked, else guesses from the name", async () => {
    const { loanKindOf } = await import("@/lib/finance/loan");
    expect(loanKindOf({ name: "SBI Home loan" })).toBe("home");
    expect(loanKindOf({ name: "HDFC car loan" })).toBe("vehicle");
    expect(loanKindOf({ name: "Bajaj personal loan" })).toBe("personal");
    expect(loanKindOf({ name: "Muthoot gold loan" })).toBe("gold");
    expect(loanKindOf({ name: "Uncle" })).toBe("other");
    expect(loanKindOf({ name: "SBI Home loan", loanKind: "education" })).toBe("education");
  });
});
