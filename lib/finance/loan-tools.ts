/**
 * What-ifs for a loan, all on the reducing balance (interest each month on what's still owed), the way Indian banks
 * charge it: prepaying, a rate change, switching lenders, the home loan tax deductions, how affordable an EMI is,
 * and two offers side by side. Amounts are in paise; rates in basis points a year (8.5% is 850).
 */
import { calcEmi } from "./loan";

/** A loan from today on: what's owed, its rate, its EMI and how many EMIs are left. */
export interface LoanNow {
  balanceMinor: number;
  annualRateBps: number;
  emiMinor: number;
  monthsLeft: number;
}

export interface Outcome {
  months: number;
  interestMinor: number;
  /** The EMI paid (after a prepayment that lowers it, the new one). */
  emiMinor: number;
  /** The EMI no longer covers the month's interest: the loan would never be repaid. */
  neverEnds?: boolean;
}

const rateOf = (bps: number) => bps / 10000 / 12;
const toRupee = (minor: number) => Math.round(minor / 100) * 100;
const CAP = 1200; // 100 years of EMIs: past this, a loan doesn't end

/**
 * Month by month until it's repaid: interest on what's owed, then the EMI (and any extra) pays it down. A lump sum
 * paid with EMI `lumpAt` (1 = the next one) comes off straight after that EMI. With `reEmiAfterLump`, the EMI is
 * worked out again after the lump sum so the loan still ends on time (the "lower my EMI" choice).
 */
export function simulate(
  loan: LoanNow,
  { lumpMinor = 0, lumpAt = 1, extraMonthlyMinor = 0, reEmiAfterLump = false }: { lumpMinor?: number; lumpAt?: number; extraMonthlyMinor?: number; reEmiAfterLump?: boolean } = {},
): Outcome {
  const r = rateOf(loan.annualRateBps);
  let balance = loan.balanceMinor;
  let emi = loan.emiMinor;
  let interest = 0;
  let months = 0;
  while (balance > 0 && months < CAP) {
    months++;
    const due = Math.round(balance * r);
    if (emi + extraMonthlyMinor <= due && !(lumpMinor > 0 && months === lumpAt)) return { months, interestMinor: interest, emiMinor: emi, neverEnds: true };
    interest += due;
    balance = Math.max(0, balance + due - emi - extraMonthlyMinor);
    if (months === lumpAt && lumpMinor > 0 && balance > 0) {
      balance = Math.max(0, balance - lumpMinor);
      if (reEmiAfterLump && balance > 0) emi = calcEmi(balance, loan.annualRateBps, Math.max(1, loan.monthsLeft - months));
    }
  }
  return { months, interestMinor: interest, emiMinor: emi, ...(balance > 0 ? { neverEnds: true } : {}) };
}

/** A prepayment's effect against carrying on as now: interest saved and EMIs cut (or the lower EMI). */
export function prepayment(loan: LoanNow, plan: { lumpMinor: number; lumpAt: number; extraMonthlyMinor: number; lowerEmi: boolean }) {
  const base = simulate(loan);
  const after = simulate(loan, { lumpMinor: plan.lumpMinor, lumpAt: plan.lumpAt, extraMonthlyMinor: plan.extraMonthlyMinor, reEmiAfterLump: plan.lowerEmi });
  return {
    base,
    after,
    interestSavedMinor: Math.max(0, base.interestMinor - after.interestMinor),
    monthsCut: Math.max(0, base.months - after.months),
    emiDropMinor: Math.max(0, base.emiMinor - after.emiMinor),
  };
}

/**
 * A new rate from now on. Banks usually keep the EMI and change the tenure (more EMIs when it goes up); the other
 * way keeps the end date and changes the EMI. Both against carrying on at the old rate.
 */
export function rateChange(loan: LoanNow, newRateBps: number) {
  const base = simulate(loan);
  const keepEmi = simulate({ ...loan, annualRateBps: newRateBps });
  const newEmi = calcEmi(loan.balanceMinor, newRateBps, loan.monthsLeft);
  const keepTenure = simulate({ ...loan, annualRateBps: newRateBps, emiMinor: newEmi });
  return {
    base,
    keepEmi: { ...keepEmi, monthsMore: keepEmi.months - base.months, interestMoreMinor: keepEmi.interestMinor - base.interestMinor },
    keepTenure: { ...keepTenure, emiMinor: newEmi, emiMoreMinor: newEmi - loan.emiMinor, interestMoreMinor: keepTenure.interestMinor - base.interestMinor },
  };
}

/**
 * Moving the loan to another lender at a lower rate, for the same months left: the interest it saves, less the fee,
 * and how many months until the saving has paid the fee back.
 */
export function balanceTransfer(loan: LoanNow, newRateBps: number, feeMinor: number) {
  const base = simulate(loan);
  const newEmi = calcEmi(loan.balanceMinor, newRateBps, loan.monthsLeft);
  const moved = simulate({ ...loan, annualRateBps: newRateBps, emiMinor: newEmi });
  // Month by month, what the lower interest has saved so far, to find when it covers the fee.
  const rOld = rateOf(loan.annualRateBps);
  const rNew = rateOf(newRateBps);
  let bOld = loan.balanceMinor;
  let bNew = loan.balanceMinor;
  let saved = 0;
  let breakEven: number | null = feeMinor <= 0 ? 0 : null;
  for (let m = 1; m <= loan.monthsLeft && (bOld > 0 || bNew > 0); m++) {
    const iOld = Math.round(bOld * rOld);
    const iNew = Math.round(bNew * rNew);
    saved += iOld - iNew;
    bOld = Math.max(0, bOld + iOld - loan.emiMinor);
    bNew = Math.max(0, bNew + iNew - newEmi);
    if (breakEven === null && saved >= feeMinor) breakEven = m;
  }
  const grossSavingMinor = base.interestMinor - moved.interestMinor;
  return { base, moved, newEmiMinor: newEmi, grossSavingMinor, netSavingMinor: grossSavingMinor - feeMinor, breakEvenMonth: breakEven };
}

/** An offer: what's borrowed, the rate, the tenure and the fees paid up front (processing, legal…). */
export interface Offer {
  principalMinor: number;
  annualRateBps: number;
  tenureMonths: number;
  feeMinor: number;
}

/**
 * One offer's real cost: its EMI, the interest, the interest plus fees, and the effective rate a year once the fees
 * are counted (the rate at which the EMIs repay only what you actually received, the amount less the fees).
 */
export function offerCost(o: Offer) {
  const emi = calcEmi(o.principalMinor, o.annualRateBps, o.tenureMonths);
  const run = simulate({ balanceMinor: o.principalMinor, annualRateBps: o.annualRateBps, emiMinor: emi, monthsLeft: o.tenureMonths });
  return {
    emiMinor: emi,
    interestMinor: run.interestMinor,
    totalCostMinor: run.interestMinor + o.feeMinor,
    totalPaidMinor: o.principalMinor + run.interestMinor + o.feeMinor,
    effectiveRateBps: effectiveRate(o.principalMinor - o.feeMinor, emi, o.tenureMonths),
  };
}

/** The yearly rate at which `months` EMIs of `emiMinor` are worth exactly `receivedMinor` today (found by halving). */
export function effectiveRate(receivedMinor: number, emiMinor: number, months: number): number {
  if (receivedMinor <= 0 || emiMinor <= 0 || months <= 0) return 0;
  const worth = (yearly: number) => {
    const r = yearly / 12;
    return r === 0 ? emiMinor * months : (emiMinor * (1 - Math.pow(1 + r, -months))) / r;
  };
  if (worth(0) <= receivedMinor) return 0;
  let lo = 0;
  let hi = 1; // 100% a year
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (worth(mid) > receivedMinor) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 10000);
}

/** Section 80C (principal) and 24(b) (interest on a self-occupied home) yearly limits, old tax regime. */
export const LIMIT_80C_MINOR = 1_50_000_00;
export const LIMIT_24B_MINOR = 2_00_000_00;

export interface TaxYear {
  /** "2026-27": April to March. */
  fy: string;
  principalMinor: number;
  interestMinor: number;
  deduction80cMinor: number;
  deduction24bMinor: number;
  /** At the slab rate given, with 4% cess. */
  taxSavedMinor: number;
}

/**
 * A home loan's deductions by financial year (April–March), from its EMI schedule: principal repaid under 80C (up to
 * ₹1.5 lakh, shared with PPF, ELSS, insurance…) and interest under 24(b) (up to ₹2 lakh for a home you live in). Old
 * regime only; the new regime allows neither for a self-occupied home.
 */
export function homeLoanTax(rows: { date: string; principalMinor: number; interestMinor: number }[], slabPercent: number): TaxYear[] {
  const years: TaxYear[] = [];
  for (const r of rows) {
    const y = Number(r.date.slice(0, 4));
    const start = Number(r.date.slice(5, 7)) >= 4 ? y : y - 1;
    const fy = `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
    let year = years.at(-1);
    if (!year || year.fy !== fy) {
      year = { fy, principalMinor: 0, interestMinor: 0, deduction80cMinor: 0, deduction24bMinor: 0, taxSavedMinor: 0 };
      years.push(year);
    }
    year.principalMinor += r.principalMinor;
    year.interestMinor += r.interestMinor;
  }
  for (const y of years) {
    y.deduction80cMinor = Math.min(y.principalMinor, LIMIT_80C_MINOR);
    y.deduction24bMinor = Math.min(y.interestMinor, LIMIT_24B_MINOR);
    y.taxSavedMinor = Math.round(((y.deduction80cMinor + y.deduction24bMinor) * slabPercent * 1.04) / 100);
  }
  return years;
}

export type AffordBand = "comfortable" | "manageable" | "stretched" | "risky";

const BAND_ORDER: AffordBand[] = ["comfortable", "manageable", "stretched", "risky"];
const worse = (a: AffordBand, b: AffordBand) => (BAND_ORDER.indexOf(a) >= BAND_ORDER.indexOf(b) ? a : b);

/** What already goes out each month, before the new EMI. */
export interface Outgoings {
  /** Usual spending: food, bills, shopping, lifestyle (EMI interest left out, it's in the EMIs). */
  spendMinor: number;
  /** EMIs on loans you already have. */
  otherEmisMinor: number;
  /** Paying people back what you borrowed. */
  repayPeopleMinor: number;
}

/**
 * Whether an EMI fits your month, judged two ways, and the verdict is the worse of them:
 * - What's left once everything is paid (your usual spending, the EMIs you already pay, paying people back, and
 *   this EMI): 30% of income or more spare is comfortable, 15% manageable, anything less stretched, below zero risky.
 * - All EMIs as a share of income, as banks judge it: up to 30% comfortable, 40% manageable, 50% stretched, more risky.
 * Also the most EMI that keeps both at "manageable" or better.
 */
export function affordability({ emiMinor, incomeMinor, outgoings }: { emiMinor: number; incomeMinor: number; outgoings: Outgoings }) {
  const { spendMinor, otherEmisMinor, repayPeopleMinor } = outgoings;
  const allEmis = emiMinor + otherEmisMinor;
  if (incomeMinor <= 0) return { allEmisMinor: allEmis, emiShare: null, leftMinor: -spendMinor - allEmis - repayPeopleMinor, leftShare: null, band: null, by: null, roomMinor: 0 };
  const emiShare = allEmis / incomeMinor;
  const leftMinor = incomeMinor - spendMinor - allEmis - repayPeopleMinor;
  const leftShare = leftMinor / incomeMinor;
  const byEmi: AffordBand = emiShare <= 0.3 ? "comfortable" : emiShare <= 0.4 ? "manageable" : emiShare <= 0.5 ? "stretched" : "risky";
  const byLeft: AffordBand = leftShare >= 0.3 ? "comfortable" : leftShare >= 0.15 ? "manageable" : leftShare >= 0 ? "stretched" : "risky";
  const band = worse(byEmi, byLeft);
  // The most EMI with all EMIs within 40% of income and at least 15% of income still spare.
  const roomMinor = Math.max(0, toRupee(Math.min(incomeMinor * 0.4 - otherEmisMinor, incomeMinor * 0.85 - spendMinor - otherEmisMinor - repayPeopleMinor)));
  return { allEmisMinor: allEmis, emiShare, leftMinor, leftShare, band, by: band === byLeft ? ("left" as const) : ("emi" as const), roomMinor };
}
