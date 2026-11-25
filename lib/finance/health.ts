import { addDays, monthEnd, monthStart, shiftMonth } from "@/lib/domain/dates";
import { DEFAULT_CARD_LIMIT_MINOR } from "./card-bill-status";
import { balanceSeries, firstActivityDate } from "./series";
import { applyAnchorGaps, applyAnchorGapsToSeries, type AnchorGap } from "./statement-anchor";
import { deriveState, periodReport } from "./state";
import type { Book, Ledger } from "./types";

/**
 * Money health: a few ratios that say how sound things are, at the end of a day (today, or a month's last day),
 * each from the same figures the rest of the app shows. "Typical month" figures are the average of the last three
 * complete months up to that day (fewer if you started recording more recently).
 */

export type HealthTone = "good" | "ok" | "bad" | "none";

export interface MoneyHealth {
  asOf: string;
  /** The complete months the averages are over (oldest first). */
  months: string[];
  /**
   * How many months your money would last: bank and cash (as the statements say) less what you owe that will
   * leave it (card dues, already spent; money owed to people), over what goes out in a typical month: spending
   * plus the part of EMIs that repays the loan (their interest is already spending). Bank loans aren't taken off:
   * they're repaid through the EMIs counted each month.
   */
  runway: {
    liquidMinor: number;
    cardDuesMinor: number;
    availableMinor: number;
    avgSpentMinor: number;
    avgEmiPrincipalMinor: number;
    monthlyNeedMinor: number;
    owedToPeopleMinor: number;
    months: number | null;
    tone: HealthTone;
  };
  /** Share of income kept: in the month shown, and over the typical months. Basis points. */
  savings: { incomeMinor: number; spentMinor: number; bps: number | null; avgBps: number | null; tone: HealthTone };
  /** Loan EMIs paid in a typical month against typical income. */
  emi: { avgEmiMinor: number; avgIncomeMinor: number; bps: number | null; tone: HealthTone };
  /** What you owe against what you own. */
  debt: { liabilitiesMinor: number; assetsMinor: number; bps: number | null; tone: HealthTone };
  /** Credit card dues against the cards' limits (null without cards). */
  cards: { duesMinor: number; limitMinor: number; bps: number | null; tone: HealthTone };
  /** Money people owe you, against everything you own. */
  owed: { owedMinor: number; assetsMinor: number; bps: number | null; tone: HealthTone };
  /** Your fixed costs (as you list them) plus loan EMIs, a month, against typical income. */
  fixed: { recurringMinor: number; emiMinor: number; totalMinor: number; avgIncomeMinor: number; bps: number | null; tone: HealthTone };
  /** Net worth now, and how it moved over the last 1, 3 and 12 months (null before you started recording). */
  growth: { netWorthMinor: number; m1: number | null; m3: number | null; m12: number | null; tone: HealthTone };
  /** Everything behind the ratios, for "how it's worked out". */
  detail: HealthDetail;
}

export interface HealthLine {
  label: string;
  amountMinor: number;
  accountId?: string;
  personId?: string;
}

export interface HealthDetail {
  /** Each bank and cash account. */
  liquid: HealthLine[];
  /** The typical months, each in full. */
  monthly: { ym: string; incomeMinor: number; spentMinor: number; emiMinor: number }[];
  /** EMIs paid in the typical months, per loan. */
  emis: (HealthLine & { count: number })[];
  /** The fixed costs you listed, each with what it comes to a month. */
  fixedCosts: { id: string; name: string; amountMinor: number; repeat: string; monthlyMinor: number }[];
  /** What you owe: each card, loan and person. */
  owe: HealthLine[];
  /** What you own: each account, holding, person and loan paid ahead. */
  own: HealthLine[];
  /** Each credit card: what's due against its limit (`limitSet` false: the ₹60,000 default). */
  cards: { accountId: string; name: string; duesMinor: number; limitMinor: number; limitSet: boolean }[];
  /** Net worth on each day compared (oldest first). */
  netWorth: { date: string; minor: number }[];
}

const ratio = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10_000) : null);
/** Lower is better: good at or under `good`, ok at or under `ok`. */
const low = (bps: number | null, good: number, ok: number): HealthTone => (bps === null ? "none" : bps <= good ? "good" : bps <= ok ? "ok" : "bad");

/** The last (up to) three complete months up to `asOf`, from the first month with entries. */
export function typicalMonths(asOf: string, firstActivity: string | null): string[] {
  const ym = asOf.slice(0, 7);
  const lastComplete = asOf === monthEnd(ym) ? ym : shiftMonth(ym, -1);
  const out: string[] = [];
  for (let i = 2; i >= 0; i--) {
    const m = shiftMonth(lastComplete, -i);
    if (firstActivity && m >= firstActivity.slice(0, 7)) out.push(m);
  }
  return out;
}

/** `fixedCosts`: the fixed costs you listed (nothing is guessed), each with its monthly amount. */
export function moneyHealth(
  book: Book,
  ledger: Ledger,
  asOf: string,
  gaps: AnchorGap[] = [],
  fixedCosts: readonly { id: string; name: string; amountMinor: number; repeat: string; monthlyMinor: number }[] = [],
): MoneyHealth {
  const state = applyAnchorGaps(deriveState(book, ledger, asOf), gaps);
  const first = firstActivityDate(ledger);
  const months = typicalMonths(asOf, first);
  const n = months.length;
  const reports = months.map((m) => periodReport(book, ledger, monthStart(m), monthEnd(m)));
  const avg = (f: (r: (typeof reports)[number]) => number) => (n ? Math.round(reports.reduce((t, r) => t + f(r), 0) / n) : 0);
  const avgSpent = avg((r) => r.expensesMinor);
  const avgIncome = avg((r) => r.incomeMinor);
  const avgSaved = avg((r) => r.incomeMinor - r.expensesMinor);

  // EMIs paid in the typical months.
  const inTypical = (date: string) => n > 0 && date >= monthStart(months[0]) && date <= monthEnd(months[n - 1]);
  const emiTotal = book.events.reduce((t, e) => (e.type === "emi_payment" && inTypical(e.date) ? t + e.amountMinor : t), 0);
  const avgEmi = n ? Math.round(emiTotal / n) : 0;
  // The interest in those EMIs is already in spending; the rest repays the loan.
  const emiInterest = book.events.reduce((t, e) => (e.type === "emi_payment" && inTypical(e.date) ? t + (e.interestMinor ?? 0) : t), 0);
  const avgEmiPrincipal = n ? Math.round((emiTotal - emiInterest) / n) : 0;

  // The month shown: from its first day to `asOf`.
  const shown = periodReport(book, ledger, monthStart(asOf.slice(0, 7)), asOf);


  const savingsBps = shown.incomeMinor > 0 ? Math.round(((shown.incomeMinor - shown.expensesMinor) / shown.incomeMinor) * 10_000) : null;
  const avgSavingsBps = avgIncome > 0 ? Math.round((avgSaved / avgIncome) * 10_000) : null;
  const savingsTone: HealthTone = (() => {
    const b = avgSavingsBps ?? savingsBps;
    return b === null ? "none" : b >= 2000 ? "good" : b >= 1000 ? "ok" : "bad";
  })();

  const cards = state.accounts.filter((a) => a.account.type === "credit_card");
  const dues = cards.reduce((t, a) => t + Math.max(0, a.balanceMinor), 0);
  const available = state.cashMinor - dues - state.liabilities.borrowedMinor;
  const monthlyNeed = avgSpent + avgEmiPrincipal;
  const runwayMonths = monthlyNeed > 0 ? Math.max(0, Math.round((available / monthlyNeed) * 10) / 10) : null;
  const limit = cards.reduce((t, a) => t + (a.account.creditLimitMinor ?? DEFAULT_CARD_LIMIT_MINOR), 0);

  const recurring = fixedCosts.reduce((t, c) => t + c.monthlyMinor, 0);
  const fixedTotal = recurring + avgEmi;

  // Net worth then and now, on the same footing as the chart.
  const back = [shiftMonth(asOf.slice(0, 7), -1), shiftMonth(asOf.slice(0, 7), -3), shiftMonth(asOf.slice(0, 7), -12)].map((m) =>
    // The same day of that month (or its last day, if shorter).
    (() => {
      const end = monthEnd(m);
      const day = `${m}-${asOf.slice(8, 10)}`;
      return day > end ? end : day;
    })(),
  );
  const dates = [...back].sort().concat(asOf);
  const series = applyAnchorGapsToSeries(balanceSeries(book, ledger, dates), gaps);
  const at = (d: string) => series.find((p) => p.date === d)!.netWorthMinor;
  const now = at(asOf);
  const since = (d: string) => (first && d >= addDays(first, -1) ? now - at(d) : null);
  const m3 = since(back[1]);
  const m1 = since(back[0]);

  const lineOf = (a: (typeof state.accounts)[number], amountMinor: number): HealthLine => ({ label: a.account.name, amountMinor, accountId: a.account.id });
  const typeIs = (...types: string[]) => state.accounts.filter((a) => types.includes(a.account.type));
  const emiByLoan = new Map<string, { amountMinor: number; count: number }>();
  for (const e of book.events) {
    if (e.type !== "emi_payment" || !inTypical(e.date)) continue;
    const x = emiByLoan.get(e.toAccountId) ?? { amountMinor: 0, count: 0 };
    x.amountMinor += e.amountMinor;
    x.count += 1;
    emiByLoan.set(e.toAccountId, x);
  }
  const detail: HealthDetail = {
    liquid: typeIs("bank", "cash").map((a) => lineOf(a, a.balanceMinor)),
    monthly: months.map((m, i) => ({
      ym: m,
      incomeMinor: reports[i].incomeMinor,
      spentMinor: reports[i].expensesMinor,
      emiMinor: book.events.reduce((t, e) => (e.type === "emi_payment" && e.date.startsWith(m) ? t + e.amountMinor : t), 0),
    })),
    emis: [...emiByLoan].map(([id, x]) => ({ label: book.accounts.find((a) => a.id === id)?.name ?? "Loan", accountId: id, amountMinor: x.amountMinor, count: x.count })),
    fixedCosts: [...fixedCosts].sort((a, b) => b.monthlyMinor - a.monthlyMinor),
    owe: [
      ...typeIs("credit_card", "loan").filter((a) => a.balanceMinor > 0).map((a) => lineOf(a, a.balanceMinor)),
      ...state.people.filter((p) => p.iOwe.outstandingMinor > 0).map((p) => ({ label: p.person.name, amountMinor: p.iOwe.outstandingMinor, personId: p.person.id })),
    ],
    own: [
      ...typeIs("bank", "cash").map((a) => lineOf(a, a.balanceMinor)),
      ...typeIs("investment").filter((a) => a.balanceMinor !== 0).map((a) => lineOf(a, a.balanceMinor)),
      ...state.people.filter((p) => p.owedToMe.outstandingMinor > 0).map((p) => ({ label: p.person.name, amountMinor: p.owedToMe.outstandingMinor, personId: p.person.id })),
      ...typeIs("loan").filter((a) => a.balanceMinor < 0).map((a) => lineOf(a, -a.balanceMinor)),
    ],
    cards: cards.map((a) => ({
      accountId: a.account.id,
      name: a.account.name,
      duesMinor: Math.max(0, a.balanceMinor),
      limitMinor: a.account.creditLimitMinor ?? DEFAULT_CARD_LIMIT_MINOR,
      limitSet: a.account.creditLimitMinor != null,
    })),
    netWorth: series.map((p) => ({ date: p.date, minor: p.netWorthMinor })),
  };

  return {
    asOf,
    months,
    detail,
    runway: {
      liquidMinor: state.cashMinor,
      cardDuesMinor: dues,
      availableMinor: available,
      avgSpentMinor: avgSpent,
      avgEmiPrincipalMinor: avgEmiPrincipal,
      monthlyNeedMinor: monthlyNeed,
      owedToPeopleMinor: state.liabilities.borrowedMinor,
      months: runwayMonths,
      tone: runwayMonths === null ? "none" : runwayMonths >= 6 ? "good" : runwayMonths >= 3 ? "ok" : "bad",
    },
    savings: { incomeMinor: shown.incomeMinor, spentMinor: shown.expensesMinor, bps: savingsBps, avgBps: avgSavingsBps, tone: savingsTone },
    emi: { avgEmiMinor: avgEmi, avgIncomeMinor: avgIncome, bps: ratio(avgEmi, avgIncome), tone: low(ratio(avgEmi, avgIncome), 3000, 4000) },
    debt: {
      liabilitiesMinor: state.liabilities.totalMinor,
      assetsMinor: state.assets.totalMinor,
      bps: ratio(state.liabilities.totalMinor, state.assets.totalMinor),
      tone: low(ratio(state.liabilities.totalMinor, state.assets.totalMinor), 3000, 5000),
    },
    cards: { duesMinor: dues, limitMinor: limit, bps: cards.length ? ratio(dues, limit) : null, tone: cards.length ? low(ratio(dues, limit), 3000, 7000) : "none" },
    owed: {
      owedMinor: state.assets.receivablesMinor,
      assetsMinor: state.assets.totalMinor,
      bps: ratio(state.assets.receivablesMinor, state.assets.totalMinor),
      tone: low(ratio(state.assets.receivablesMinor, state.assets.totalMinor), 1000, 2500),
    },
    fixed: { recurringMinor: recurring, emiMinor: avgEmi, totalMinor: fixedTotal, avgIncomeMinor: avgIncome, bps: ratio(fixedTotal, avgIncome), tone: low(ratio(fixedTotal, avgIncome), 5000, 7000) },
    growth: {
      netWorthMinor: now,
      m1,
      m3,
      m12: since(back[2]),
      tone: (m3 ?? m1) === null ? "none" : (m3 ?? m1)! > 0 ? "good" : (m3 ?? m1)! === 0 ? "ok" : "bad",
    },
  };
}
