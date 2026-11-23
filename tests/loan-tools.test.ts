import { describe, expect, it } from "vitest";
import { calcEmi } from "@/lib/finance/loan";
import { affordability, balanceTransfer, effectiveRate, homeLoanTax, offerCost, prepayment, rateChange, simulate } from "@/lib/finance/loan-tools";

// ₹30 lakh at 8.5% for 20 years.
const loan = { balanceMinor: 30_00_000_00, annualRateBps: 850, monthsLeft: 240, emiMinor: calcEmi(30_00_000_00, 850, 240) };

describe("simulate", () => {
  it("repays the loan in its tenure, as the EMI was worked out for", () => {
    const run = simulate(loan);
    expect(run.months).toBe(240);
    expect(run.neverEnds).toBeUndefined();
  });

  it("flags an EMI too small to cover the interest", () => {
    expect(simulate({ ...loan, emiMinor: 10_000_00 }).neverEnds).toBe(true);
  });
});

describe("prepayment", () => {
  it("a lump sum early cuts EMIs and saves interest", () => {
    const p = prepayment(loan, { lumpMinor: 5_00_000_00, lumpAt: 1, extraMonthlyMinor: 0, lowerEmi: false });
    expect(p.monthsCut).toBeGreaterThan(50);
    expect(p.interestSavedMinor).toBeGreaterThan(10_00_000_00);
    expect(p.after.emiMinor).toBe(loan.emiMinor);
  });

  it("or keeps the end date and lowers the EMI, saving less", () => {
    const shorter = prepayment(loan, { lumpMinor: 5_00_000_00, lumpAt: 1, extraMonthlyMinor: 0, lowerEmi: false });
    const lower = prepayment(loan, { lumpMinor: 5_00_000_00, lumpAt: 1, extraMonthlyMinor: 0, lowerEmi: true });
    expect(lower.emiDropMinor).toBeGreaterThan(0);
    expect(Math.abs(lower.after.months - 240)).toBeLessThanOrEqual(1);
    expect(lower.interestSavedMinor).toBeLessThan(shorter.interestSavedMinor);
  });

  it("paying a little extra every month shortens it too", () => {
    expect(prepayment(loan, { lumpMinor: 0, lumpAt: 1, extraMonthlyMinor: 2_000_00, lowerEmi: false }).monthsCut).toBeGreaterThan(20);
  });
});

describe("rate change", () => {
  it("a higher rate means more EMIs at the same EMI, or a bigger EMI to finish on time", () => {
    const c = rateChange(loan, 925);
    expect(c.keepEmi.monthsMore).toBeGreaterThan(20);
    expect(c.keepTenure.emiMoreMinor).toBeGreaterThan(0);
    expect(Math.abs(c.keepTenure.months - 240)).toBeLessThanOrEqual(1);
  });
});

describe("balance transfer", () => {
  it("nets the fee off the interest saved, and finds when it's paid back", () => {
    const t = balanceTransfer(loan, 800, 10_000_00);
    expect(t.grossSavingMinor).toBeGreaterThan(0);
    expect(t.netSavingMinor).toBe(t.grossSavingMinor - 10_000_00);
    expect(t.breakEvenMonth).toBeGreaterThan(0);
    expect(t.breakEvenMonth).toBeLessThan(24);
  });
});

describe("offers", () => {
  it("fees push the effective rate above the quoted one", () => {
    const c = offerCost({ principalMinor: 10_00_000_00, annualRateBps: 1000, tenureMonths: 60, feeMinor: 20_000_00 });
    expect(c.effectiveRateBps).toBeGreaterThan(1000);
    expect(effectiveRate(10_00_000_00, c.emiMinor, 60)).toBeCloseTo(1000, -1);
  });
});

describe("home loan tax", () => {
  it("groups by April–March and caps 80C at ₹1.5 lakh and 24(b) at ₹2 lakh", () => {
    const rows = [
      { date: "2026-03-05", principalMinor: 10_000_00, interestMinor: 30_000_00 },
      { date: "2026-04-05", principalMinor: 1_60_000_00, interestMinor: 2_50_000_00 },
    ];
    const [a, b] = homeLoanTax(rows, 30);
    expect(a.fy).toBe("2025-26");
    expect(b.fy).toBe("2026-27");
    expect(b.deduction80cMinor).toBe(1_50_000_00);
    expect(b.deduction24bMinor).toBe(2_00_000_00);
    expect(b.taxSavedMinor).toBe(Math.round((3_50_000_00 * 30 * 1.04) / 100));
  });
});

describe("affordability", () => {
  const none = { spendMinor: 0, otherEmisMinor: 0, repayPeopleMinor: 0 };
  it("a small EMI on its own is comfortable", () => {
    expect(affordability({ emiMinor: 20_000_00, incomeMinor: 1_00_000_00, outgoings: none })).toMatchObject({ band: "comfortable", leftMinor: 80_000_00 });
  });

  it("counts your spending, other EMIs and paying people back: little left makes it stretched", () => {
    const a = affordability({ emiMinor: 20_000_00, incomeMinor: 1_00_000_00, outgoings: { spendMinor: 50_000_00, otherEmisMinor: 10_000_00, repayPeopleMinor: 10_000_00 } });
    expect(a.leftMinor).toBe(10_000_00);
    expect(a.band).toBe("stretched");
    expect(a.by).toBe("left");
  });

  it("can't be afforded when it all comes to more than the income", () => {
    expect(affordability({ emiMinor: 20_000_00, incomeMinor: 50_000_00, outgoings: { ...none, spendMinor: 40_000_00 } }).band).toBe("risky");
  });

  it("banks' EMI limit still applies even with money left over", () => {
    const a = affordability({ emiMinor: 45_000_00, incomeMinor: 1_00_000_00, outgoings: none });
    expect(a.band).toBe("stretched");
    expect(a.by).toBe("emi");
  });

  it("suggests the most EMI that stays manageable", () => {
    expect(affordability({ emiMinor: 1, incomeMinor: 1_00_000_00, outgoings: { spendMinor: 50_000_00, otherEmisMinor: 0, repayPeopleMinor: 5_000_00 } }).roomMinor).toBe(30_000_00);
    expect(affordability({ emiMinor: 1, incomeMinor: 0, outgoings: none }).band).toBeNull();
  });
});
