import { nextDue } from "./bills";
import type { Account, Book, FinancialEvent, LoanKind, LoanTerms } from "./types";

export type { LoanTerms };

/** Loan purposes in the order the Money page lists them. */
export const LOAN_KINDS: { value: LoanKind; label: string }[] = [
  { value: "home", label: "Home" },
  { value: "vehicle", label: "Car / vehicle" },
  { value: "personal", label: "Personal" },
  { value: "education", label: "Education" },
  { value: "gold", label: "Gold" },
  { value: "other", label: "Other" },
];

/** A loan's purpose: the one you picked, else a guess from its name ("HDFC home loan" is a home loan). */
export function loanKindOf(account: { name: string; loanKind?: LoanKind }): LoanKind {
  if (account.loanKind) return account.loanKind;
  const n = account.name.toLowerCase();
  if (/home|house|housing|flat|property|mortgage|plot/.test(n)) return "home";
  if (/car|bike|vehicle|auto|scooter|two.?wheeler|motor/.test(n)) return "vehicle";
  if (/educat|study|student|college|university/.test(n)) return "education";
  if (/gold/.test(n)) return "gold";
  if (/personal|\bpl\b|consumer|instant/.test(n)) return "personal";
  return "other";
}

export interface ScheduleRow {
  /** 1 for the first EMI. */
  n: number;
  date: string;
  emiMinor: number;
  interestMinor: number;
  principalMinor: number;
  /** Still owed after this EMI. */
  balanceMinor: number;
}

const monthlyRate = (annualRateBps: number) => annualRateBps / 10000 / 12;
/** Banks charge EMIs in whole rupees. */
const toRupee = (minor: number) => Math.round(minor / 100) * 100;

/** The monthly instalment that repays `principalMinor` over `months` at the yearly rate: P·r·(1+r)^n / ((1+r)^n − 1). */
export function calcEmi(principalMinor: number, annualRateBps: number, months: number): number {
  if (principalMinor <= 0 || months <= 0) return 0;
  const r = monthlyRate(annualRateBps);
  if (r === 0) return toRupee(Math.ceil(principalMinor / months));
  const growth = Math.pow(1 + r, months);
  return toRupee((principalMinor * r * growth) / (growth - 1));
}

export const emiOf = (terms: LoanTerms) => terms.emiMinor ?? calcEmi(terms.principalMinor, terms.annualRateBps, terms.tenureMonths);

/** The date of EMI number `n` (1-based): monthly from the first, on the same day (the last day in shorter months). */
export const emiDate = (terms: LoanTerms, n: number) => nextDue(terms.firstEmiDate, "monthly", n - 1, Number(terms.firstEmiDate.slice(8)));

/**
 * Month by month from `startBalanceMinor`: each EMI pays the month's interest on what's owed, and the rest pays the
 * loan down. The last EMI is only what's left, so the schedule ends at exactly zero. `firstN` numbers the first row.
 */
export function amortize(terms: LoanTerms, startBalanceMinor = terms.principalMinor, firstN = 1): ScheduleRow[] {
  const r = monthlyRate(terms.annualRateBps);
  const emi = emiOf(terms);
  const rows: ScheduleRow[] = [];
  let balance = startBalanceMinor;
  // An EMI too small to cover the interest would never end: stop after the tenure (and a safety margin).
  const limit = Math.max(terms.tenureMonths, 1) * 3 + 12;
  for (let n = firstN; balance > 0 && rows.length < limit; n++) {
    const interest = Math.round(balance * r);
    let principal = Math.min(Math.max(emi - interest, 0), balance);
    // The EMI is rounded to the rupee, which leaves a little owing at the end: the last EMI of the tenure takes it.
    if (n >= terms.tenureMonths && balance - principal < emi) principal = balance;
    balance -= principal;
    rows.push({ n, date: emiDate(terms, n), emiMinor: principal + interest, interestMinor: interest, principalMinor: principal, balanceMinor: balance });
    if (principal === 0) break;
  }
  return rows;
}

/** The whole loan as planned: the EMI, what it all costs, and when it ends. */
export function loanPlan(terms: LoanTerms) {
  const rows = amortize(terms);
  const interest = rows.reduce((t, r) => t + r.interestMinor, 0);
  return {
    emiMinor: emiOf(terms),
    totalInterestMinor: interest,
    totalPaidMinor: terms.principalMinor + interest,
    lastEmiDate: rows.at(-1)?.date ?? terms.firstEmiDate,
    months: rows.length,
    rows,
  };
}

export const isEmiFor = (loanId: string) => (e: FinancialEvent): e is Extract<FinancialEvent, { type: "emi_payment" }> =>
  e.type === "emi_payment" && e.toAccountId === loanId;

/**
 * Where a loan stands: EMIs paid (those due before you started tracking it, plus the ones recorded since), the
 * next EMI with its interest and principal parts, and, from what's actually still owed (prepayments included), how
 * many EMIs and how much interest are left.
 */
export function loanProgress(account: Account, terms: LoanTerms, book: Book, owedMinor: number) {
  const plan = loanPlan(terms);
  // EMIs due before the loan's records begin were paid before tracking: the amount owed then already reflects them.
  const before = plan.rows.filter((r) => r.date < account.openedOn).length;
  const recorded = book.events.filter(isEmiFor(account.id));
  const paid = recorded.reduce(
    (t, e) => ({ interest: t.interest + e.interestMinor, principal: t.principal + (e.amountMinor - e.interestMinor) }),
    { interest: 0, principal: 0 },
  );
  const emisPaid = before + recorded.length;
  const owed = Math.max(owedMinor, 0);
  const ahead = amortize(terms, owed, emisPaid + 1);
  const next = ahead[0];
  return {
    plan,
    emisPaid,
    emisLeft: ahead.length,
    owedMinor: owed,
    next: next ? { n: next.n, date: next.date, emiMinor: next.emiMinor, interestMinor: next.interestMinor, principalMinor: next.principalMinor } : null,
    interestLeftMinor: ahead.reduce((t, r) => t + r.interestMinor, 0),
    lastEmiDate: ahead.at(-1)?.date ?? null,
    /** What's been repaid of the amount borrowed, 0–1. */
    repaidShare: terms.principalMinor > 0 ? Math.min(1, Math.max(0, 1 - owed / terms.principalMinor)) : 0,
    interestPaidMinor: paid.interest,
    principalPaidMinor: paid.principal,
    /** The rest of the schedule from what's owed now. */
    ahead,
  };
}

/** What's owed after the EMIs due before `date`, by the plan: a sensible "owed today" for a loan you're already repaying. */
export function plannedOwedOn(terms: LoanTerms, date: string): number {
  const rows = loanPlan(terms).rows.filter((r) => r.date < date);
  return rows.at(-1)?.balanceMinor ?? terms.principalMinor;
}
