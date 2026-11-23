import { addDays, daysBetween, monthEnd, monthStart, shiftMonth } from "@/lib/domain/dates";
import { personDebts } from "@/lib/finance/debts";
import { emiOf, loanKindOf, loanProgress } from "@/lib/finance/loan";
import type { RecurringCharge } from "@/lib/finance/recurring";
import type { Reminder } from "@/lib/finance/reminders";
import { isMoneyBack, type FinancialState, type PeriodReport } from "@/lib/finance/state";
import { involvesPerson, personSummary } from "@/lib/finance/person-summary";
import { firstActivityDate } from "@/lib/finance/series";
import type { Book, Ledger } from "@/lib/finance/types";

/**
 * Everything the AI CA answers from, worked out by the app, in rupees: what you have, what you owe and on what
 * terms, what comes in and goes out (essentials apart from lifestyle), what's due soon, and the ready-made measures a
 * CA would look at first (how long the money lasts with no income, EMIs against income, emergency fund…). The AI
 * reasons on top of these and never does arithmetic of its own on raw entries.
 */
export interface AdvisorSnapshot {
  today: string;
  /** How far back your records go, and how many months the averages cover. */
  records: { since: string | null; averageMonths: number };
  have: {
    bankAndCash: number;
    accounts: { name: string; type: string; balance: number }[];
    investments: number;
    owedToYou: number;
    peopleWhoOweYou: { name: string; owes: number }[];
  };
  owe: {
    total: number;
    creditCards: { name: string; owed: number }[];
    loans: { name: string; purpose: string; owed: number; emi: number | null; ratePercent: number | null; emisLeft: number | null; nextEmi: string | null; endsBy: string | null }[];
    people: { name: string; owed: number; dueBy: string | null; nextInstalment: { date: string; amount: number } | null; interestSoFar: number; interestTerms: string | null }[];
  };
  netWorth: number;
  /** Monthly averages over the recent span (records.averageMonths). */
  monthly: {
    income: number;
    spending: number;
    essentialSpending: number;
    lifestyleSpending: number;
    emis: number;
    subscriptions: number;
    payingPeopleBack: number;
    savedAfterEverything: number;
    topSpending: { category: string; amount: number }[];
  };
  /** Income and spending month by month, oldest first (the current month so far last). */
  /**
   * Month by month, oldest first (the current month so far last): income and spending, income by category (Salary,
   * Interest…) and by who paid it (the payer as entered, e.g. the employer), so salary can be told from other income.
   */
  history: {
    month: string;
    income: number;
    spending: number;
    incomeByCategory: { category: string; amount: number }[];
    incomeFrom: { payer: string; amount: number; dates: string[] }[];
  }[];
  dueNext30Days: { what: string; date: string; amount: number }[];
  measures: {
    /** Months bank & cash last with no income, at the usual essential spending plus EMIs and people's instalments. */
    monthsWithoutIncome: number | null;
    /** The same, at your usual total spending (lifestyle included). */
    monthsWithoutIncomeAtCurrentLifestyle: number | null;
    /** Bank & cash as months of essential spending + EMIs (6+ is the usual target). */
    emergencyFundMonths: number | null;
    /** All EMIs plus repayments to people, as a share of income (banks lend up to about 40–50%). */
    emisAndRepaymentsToIncomePercent: number | null;
    /** Of income, what's left after everything (spending, EMIs, paying people). */
    savingsRatePercent: number | null;
    /** The most new EMI that keeps all EMIs within 40% of income and leaves 15% of income spare. */
    roomForNewEmi: number;
    /** Everything owed against everything owned. */
    debtToAssetsPercent: number | null;
    /** Bank & cash after everything due in the next 30 days. */
    afterDuesNext30Days: number;
  };
  /** How each measure was worked out, in words, so it's never read as contradicting another figure. */
  howMeasured: Record<string, string>;
  /** Everything ever, with each person: borrowed, repaid (and interest), lent, got back, still owed either way. */
  peopleAllTime: {
    name: string;
    otherNames?: string[];
    borrowed: number;
    repaid: number;
    interestPaid: number;
    stillOwe: number;
    lent: number;
    gotBack: number;
    stillOwedToYou: number;
    paidToThemAsSpending: number;
    receivedFromThemAsIncome: number;
    splitShares: number;
    firstDate: string | null;
    lastDate: string | null;
  }[];
  /** Each bank loan's totals: taken, EMIs paid (principal and interest), still owed. */
  loansAllTime: { name: string; taken: number; emisPaid: number; emiCount: number; principalPaid: number; interestPaid: number; stillOwed: number }[];
  /** Spending by category, month by month (oldest first). */
  spendingByMonth: { month: string; byCategory: { category: string; amount: number }[] }[];
  /**
   * Every entry in the last 12 months (newest first, up to 2,000): [date, kind, amount ₹, who / payee, category,
   * account(s), reason]. For anything the totals above don't answer; add up the matching rows.
   */
  entries: { columns: string[]; rows: (string | number)[][]; truncated: boolean };
}

/** Categories that keep the household running; the rest is lifestyle, which can be cut in a bad month. */
const ESSENTIAL = new Set(["rent", "bills", "grocery", "health", "transport", "petrol", "maintenance", "emi", "subscriptions"]);

const rs = (minor: number) => Math.round(minor / 100);

/** Every person's history with you, added up from all your entries. */
function peopleAllTime(book: Book, state: FinancialState, today: string): AdvisorSnapshot["peopleAllTime"] {
  void today;
  return book.people
    .map((person) => {
      const mine = book.events.filter((e) => involvesPerson(e, person));
      const s = personSummary(book.events, person);
      const owe = state.people.find((p) => p.person.id === person.id);
      const interestPaid = book.events.reduce((t, e) => t + (e.type === "repayment_made" && e.personId === person.id ? (e.interestMinor ?? 0) : 0), 0);
      const dates = mine.map((e) => e.date).sort();
      return {
        name: person.name,
        ...(person.aliases?.length ? { otherNames: person.aliases } : {}),
        borrowed: rs(s.borrowedMinor),
        repaid: rs(s.youRepaidMinor),
        interestPaid: rs(interestPaid),
        stillOwe: rs(Math.max(0, owe?.iOwe.outstandingMinor ?? 0)),
        lent: rs(s.lentMinor),
        gotBack: rs(s.theyRepaidMinor),
        stillOwedToYou: rs(Math.max(0, owe?.owedToMe.outstandingMinor ?? 0)),
        paidToThemAsSpending: rs(s.paidToThemMinor),
        receivedFromThemAsIncome: rs(s.receivedFromThemMinor),
        splitShares: rs(s.splits.theirShareMinor),
        firstDate: dates[0] ?? null,
        lastDate: dates.at(-1) ?? null,
      };
    })
    .filter((p) => p.borrowed || p.repaid || p.lent || p.gotBack || p.stillOwe || p.stillOwedToYou || p.paidToThemAsSpending || p.receivedFromThemAsIncome || p.splitShares);
}

/** Each bank loan's totals from its entries. */
function loansAllTime(book: Book, state: FinancialState): AdvisorSnapshot["loansAllTime"] {
  return book.accounts
    .filter((a) => a.type === "loan")
    .map((loan) => {
      const emis = book.events.filter((e): e is Extract<typeof e, { type: "emi_payment" }> => e.type === "emi_payment" && e.toAccountId === loan.id);
      const taken = book.events.reduce((t, e) => t + (e.type === "loan_taken" && e.fromAccountId === loan.id ? e.amountMinor : 0), loan.openingBalanceMinor);
      const paid = emis.reduce((t, e) => t + e.amountMinor, 0);
      const interest = emis.reduce((t, e) => t + e.interestMinor, 0);
      return {
        name: loan.name,
        taken: rs(taken),
        emisPaid: rs(paid),
        emiCount: emis.length,
        principalPaid: rs(paid - interest),
        interestPaid: rs(interest),
        stillOwed: rs(Math.max(0, state.accounts.find((a) => a.account.id === loan.id)?.balanceMinor ?? 0)),
      };
    });
}

const KIND: Record<string, string> = {
  expense: "spent",
  income: "income",
  transfer: "transfer",
  lend: "lent",
  borrow: "borrowed",
  repayment_received: "got paid back",
  repayment_made: "paid back",
  loan_taken: "loan taken",
  emi_payment: "EMI",
  split_expense: "split bill",
  reimbursable_expense: "paid, to be reimbursed",
  invest: "invested",
  sell_investment: "sold investment",
  update_valuation: "investment value",
  trade: "stock trade",
};

/** Every entry in the last 12 months, newest first, as compact rows. */
function entryRows(book: Book, today: string, categoryName: (id: string) => string): AdvisorSnapshot["entries"] {
  const since = addDays(today, -365);
  const acct = (id?: string) => (id ? (book.accounts.find((a) => a.id === id)?.name ?? "") : "");
  const who = (id?: string) => (id ? (book.people.find((p) => p.id === id)?.name ?? "") : "");
  const all = book.events.filter((e) => e.date >= since && e.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  const rows = all.slice(0, 2000).map((e) => {
    const amount = "amountMinor" in e ? e.amountMinor : "totalMinor" in e ? e.totalMinor : "proceedsMinor" in e ? e.proceedsMinor : "valueMinor" in e ? e.valueMinor : e.type === "trade" ? e.quantity * e.priceMinor : 0;
    const party = "personId" in e && e.personId ? who(e.personId) : (e.description ?? "");
    const category = "categoryId" in e && e.categoryId ? categoryName(e.categoryId) : "";
    const accounts =
      "fromAccountId" in e && "toAccountId" in e
        ? `${acct(e.fromAccountId)} → ${acct(e.toAccountId)}`
        : "accountId" in e
          ? acct(e.accountId)
          : "toAccountId" in e
            ? acct(e.toAccountId)
            : "holdingId" in e
              ? acct(e.holdingId)
              : "";
    const extra =
      e.type === "emi_payment"
        ? `interest ₹${rs(e.interestMinor)}`
        : e.type === "repayment_made" && e.interestMinor
          ? `interest ₹${rs(e.interestMinor)}`
          : e.type === "split_expense"
            ? // The whole bill is the amount; only your share is your spending.
              `your share ₹${rs(e.totalMinor - e.shares.reduce((t, x) => t + x.amountMinor, 0))}`
            : "";
    return [e.date, KIND[e.type] ?? e.type, rs(amount), party, category, accounts, [e.note?.trim(), extra].filter(Boolean).join(" · ")];
  });
  return { columns: ["date", "kind", "amount", "who", "category", "account", "reason"], rows, truncated: all.length > 2000 };
}

export function buildSnapshot(input: {
  book: Book;
  ledger: Ledger;
  /** Balances as the statements say (the dashboard's). */
  state: FinancialState;
  today: string;
  report: (from: string, to: string) => PeriodReport;
  categoryName: (id: string) => string;
  subscriptions: RecurringCharge[];
  reminders: Reminder[];
}): AdvisorSnapshot {
  const { book, ledger, state, today, report, categoryName, subscriptions, reminders } = input;

  // The recent span: the last 90 days, from no earlier than the records begin.
  const first = firstActivityDate(ledger);
  const ninety = addDays(today, -90);
  const from = first && first > ninety ? first : ninety;
  const months = Math.max(1, (daysBetween(from, today) + 1) / (365.25 / 12));
  const r = report(from, today);
  const per = (minor: number) => Math.round(minor / 100 / months);

  const byCat = r.expensesByCategory.filter((c) => c.amountMinor > 0);
  const essentialMinor = byCat.filter((c) => ESSENTIAL.has(c.categoryId) && c.categoryId !== "emi").reduce((t, c) => t + c.amountMinor, 0);
  const emiInterestMinor = byCat.filter((c) => c.categoryId === "emi").reduce((t, c) => t + c.amountMinor, 0);
  const spendingMinor = r.expensesMinor - emiInterestMinor;

  // Loans: their EMIs and where each stands.
  const loans = state.accounts
    .filter((a) => a.account.type === "loan" && a.balanceMinor > 0)
    .map(({ account, balanceMinor }) => {
      const t = account.loanTerms;
      const p = t ? loanProgress(account, t, book, balanceMinor) : null;
      return {
        name: account.name,
        purpose: loanKindOf(account),
        owed: rs(balanceMinor),
        emi: t ? rs(emiOf(t)) : null,
        ratePercent: t ? t.annualRateBps / 100 : null,
        emisLeft: p ? p.emisLeft : null,
        nextEmi: p?.next?.date ?? null,
        endsBy: p?.lastEmiDate ?? null,
      };
    });
  const loanEmis = loans.reduce((t, l) => t + (l.emi ?? 0), 0);

  // People you owe, with their terms; and what you've been paying them lately.
  const people = state.people
    .filter((p) => p.iOwe.outstandingMinor > 0)
    .map((p) => {
      const d = personDebts(book.events, p.person.id, today);
      const rate = d.debts.find((x) => x.terms?.interest)?.terms?.interest;
      return {
        name: p.person.name,
        owed: rs(p.iOwe.outstandingMinor),
        dueBy: d.dueDate ?? null,
        nextInstalment: d.nextInstalment ? { date: d.nextInstalment.date, amount: rs(d.nextInstalment.amountMinor) } : null,
        interestSoFar: rs(d.interestSoFarMinor),
        interestTerms: rate ? `${rate.rateBps / 100}% a ${rate.per}` : null,
      };
    });
  const instalments = people.reduce((t, p) => t + (p.nextInstalment?.amount ?? 0), 0);
  const repaidMinor = book.events.filter((e) => e.type === "repayment_made" && e.date >= from && e.date <= today).reduce((t, e) => t + (e.type === "repayment_made" ? e.amountMinor - (e.interestMinor ?? 0) : 0), 0);
  const payingPeopleBack = Math.max(instalments, per(repaidMinor));

  const subsMonthly = subscriptions.reduce((t, s) => t + s.monthlyEquivalentMinor, 0);

  const income = per(r.incomeMinor);
  const spending = per(spendingMinor);
  const essential = per(essentialMinor);
  const emis = loanEmis;
  const saved = income - spending - emis - payingPeopleBack;
  const bankAndCash = rs(state.cashMinor);
  const essentialOut = essential + emis + payingPeopleBack;
  const allOut = spending + emis + payingPeopleBack;

  // Month by month: the last 5 complete months and this one so far.
  const ym = today.slice(0, 7);
  const history = [-5, -4, -3, -2, -1, 0].map((k) => {
    const m = shiftMonth(ym, k);
    const to = k === 0 ? today : monthEnd(m);
    const mr = report(monthStart(m), to);
    // Who paid it: income entries grouped by payer (refunds and reimbursements aren't income).
    const payers = new Map<string, { amount: number; dates: string[] }>();
    for (const e of book.events) {
      if (e.type !== "income" || e.date < monthStart(m) || e.date > to || isMoneyBack(e)) continue;
      const payer = e.description?.trim() || categoryName(e.categoryId);
      const p = payers.get(payer) ?? { amount: 0, dates: [] };
      p.amount += e.amountMinor;
      p.dates.push(e.date);
      payers.set(payer, p);
    }
    return {
      month: m,
      income: rs(mr.incomeMinor),
      spending: rs(mr.expensesMinor),
      incomeByCategory: mr.incomeByCategory.filter((c) => c.amountMinor > 0).map((c) => ({ category: categoryName(c.categoryId), amount: rs(c.amountMinor) })),
      incomeFrom: [...payers]
        .map(([payer, v]) => ({ payer, amount: rs(v.amount), dates: v.dates.sort() }))
        .sort((x, y) => y.amount - x.amount)
        .slice(0, 6),
    };
  });
  const firstMonth = first?.slice(0, 7);

  const in30 = addDays(today, 30);
  const due = reminders
    .filter((x) => x.dueDate <= in30)
    .map((x) => ({ what: x.title, date: x.dueDate, amount: rs(x.amountMinor) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const dueTotal = due.reduce((t, d) => t + d.amount, 0);

  const owedTotal = rs(state.liabilities.totalMinor);
  const assets = rs(state.assets.totalMinor);

  return {
    today,
    records: { since: first, averageMonths: Math.round(months * 10) / 10 },
    have: {
      bankAndCash,
      accounts: state.accounts
        .filter((a) => a.account.type === "bank" || a.account.type === "cash")
        .map((a) => ({ name: a.account.name, type: a.account.type, balance: rs(a.balanceMinor) })),
      investments: rs(state.investments.valueMinor),
      owedToYou: rs(state.assets.receivablesMinor),
      peopleWhoOweYou: state.people.filter((p) => p.owedToMe.outstandingMinor > 0).map((p) => ({ name: p.person.name, owes: rs(p.owedToMe.outstandingMinor) })),
    },
    owe: {
      total: owedTotal,
      creditCards: state.accounts.filter((a) => a.account.type === "credit_card" && a.balanceMinor > 0).map((a) => ({ name: a.account.name, owed: rs(a.balanceMinor) })),
      loans,
      people,
    },
    netWorth: rs(state.netWorthMinor),
    monthly: {
      income,
      spending,
      essentialSpending: essential,
      lifestyleSpending: Math.max(0, spending - essential),
      emis,
      subscriptions: rs(subsMonthly),
      payingPeopleBack,
      savedAfterEverything: saved,
      topSpending: [...byCat]
        .filter((c) => c.categoryId !== "emi")
        .sort((a, b) => b.amountMinor - a.amountMinor)
        .slice(0, 6)
        .map((c) => ({ category: categoryName(c.categoryId), amount: per(c.amountMinor) })),
    },
    history: history.filter((h) => !firstMonth || h.month >= firstMonth),
    dueNext30Days: due,
    measures: {
      monthsWithoutIncome: essentialOut > 0 ? Math.round((bankAndCash / essentialOut) * 10) / 10 : null,
      monthsWithoutIncomeAtCurrentLifestyle: allOut > 0 ? Math.round((bankAndCash / allOut) * 10) / 10 : null,
      emergencyFundMonths: essential + emis > 0 ? Math.round((bankAndCash / (essential + emis)) * 10) / 10 : null,
      emisAndRepaymentsToIncomePercent: income > 0 ? Math.round(((emis + payingPeopleBack) / income) * 100) : null,
      savingsRatePercent: income > 0 ? Math.round((saved / income) * 100) : null,
      roomForNewEmi: income > 0 ? Math.max(0, Math.round(Math.min(income * 0.4 - emis - payingPeopleBack, income * 0.85 - spending - emis - payingPeopleBack))) : 0,
      debtToAssetsPercent: assets > 0 ? Math.round((owedTotal / assets) * 100) : null,
      afterDuesNext30Days: bankAndCash - dueTotal,
    },
    peopleAllTime: peopleAllTime(book, state, today),
    loansAllTime: loansAllTime(book, state),
    spendingByMonth: [-5, -4, -3, -2, -1, 0]
      .map((k) => shiftMonth(ym, k))
      .filter((m) => !firstMonth || m >= firstMonth)
      .map((m) => ({
        month: m,
        byCategory: report(monthStart(m), m === ym ? today : monthEnd(m))
          .expensesByCategory.filter((c) => c.amountMinor > 0)
          .sort((a, b) => b.amountMinor - a.amountMinor)
          .map((c) => ({ category: categoryName(c.categoryId), amount: rs(c.amountMinor) })),
      })),
    entries: entryRows(book, today, categoryName),
    howMeasured: {
      monthsWithoutIncome: "bankAndCash ÷ (essential spending + EMIs + paying people back) a month",
      monthsWithoutIncomeAtCurrentLifestyle: "bankAndCash ÷ (all spending + EMIs + paying people back) a month",
      emergencyFundMonths: "bankAndCash ÷ (essential spending + EMIs) a month; repayments to people left out",
      emisAndRepaymentsToIncomePercent: "(EMIs + paying people back) ÷ income",
      savingsRatePercent: "savedAfterEverything ÷ income",
      roomForNewEmi: "the smaller of: 40% of income − EMIs − paying people back; 85% of income − spending − EMIs − paying people back",
      payingPeopleBack: "the larger of: people's next instalments, and what you actually paid people back a month lately",
      owedToYou: "everything owed to you (people, and cards or loans paid beyond what they owed)",
      averages: `monthly figures are averages over the last ${Math.round(months * 10) / 10} months of records`,
    },
  };
}
