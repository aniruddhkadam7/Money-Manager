import { idOf, ledgerIds } from "./engine";
import {
  isAssetAccount,
  type Account,
  type Book,
  type FinancialEvent,
  type FlowKind,
  type Ledger,
  type LedgerEntry,
  type Person,
} from "./types";

/* ---------------- Balances & net worth ---------------- */

export interface AccountBalance {
  account: Account;
  /** For assets: what it holds. For cards/loans: what is owed. Always read as "how much". */
  balanceMinor: number;
}

export interface HoldingSummary {
  account: Account;
  valueMinor: number;
  costBasisMinor: number;
  gainMinor: number;
}

export interface PersonSummary {
  person: Person;
  /** Money they owe me. */
  owedToMe: { originalMinor: number; receivedMinor: number; outstandingMinor: number };
  /** Money I owe them. */
  iOwe: { originalMinor: number; repaidMinor: number; outstandingMinor: number };
}

export interface FinancialState {
  asOf: string;
  accounts: AccountBalance[];
  /** Spendable money: bank + cash. */
  cashMinor: number;
  /**
   * creditBalancesMinor: cards and loans paid beyond what they owe (a card "in credit"). That is money owed
   * to you, so it counts here, not as a smaller liability: liabilities only ever show what you actually owe.
   */
  assets: { totalMinor: number; cashMinor: number; investmentsMinor: number; receivablesMinor: number; creditBalancesMinor: number };
  liabilities: { totalMinor: number; creditCardsMinor: number; loansMinor: number; borrowedMinor: number };
  /** Always assets − liabilities. Derived, never stored or edited. */
  netWorthMinor: number;
  investments: {
    valueMinor: number;
    costBasisMinor: number;
    gainMinor: number;
    holdings: HoldingSummary[];
  };
  people: PersonSummary[];
}

/** Everything as of the end of `asOf` (inclusive). Entries dated later are ignored. */
export function deriveState(book: Book, ledger: Ledger, asOf: string): FinancialState {
  const balance = new Map<string, number>();
  const cost = new Map<string, number>();
  const validIds = new Set<string>();

  for (const entry of ledger.entries) {
    if (entry.date > asOf) continue;
    validIds.add(entry.sourceId);
    for (const p of entry.postings) balance.set(p.ledger, (balance.get(p.ledger) ?? 0) + p.amountMinor);
    if (entry.costDelta) {
      cost.set(entry.costDelta.accountId, (cost.get(entry.costDelta.accountId) ?? 0) + entry.costDelta.deltaMinor);
    }
  }
  const bal = (id: string) => balance.get(id) ?? 0;

  const accounts: AccountBalance[] = book.accounts.map((account) => {
    const raw = bal(ledgerIds.account(account.id));
    return { account, balanceMinor: isAssetAccount(account.type) ? raw : -raw };
  });

  const sumOf = (types: Account["type"][]) =>
    accounts.filter((a) => types.includes(a.account.type)).reduce((t, a) => t + a.balanceMinor, 0);

  const cashMinor = sumOf(["bank", "cash"]);
  const investmentsMinor = sumOf(["investment"]);
  // Each card and loan counts what it is owed; one paid beyond that is a credit balance, i.e. an asset.
  const owedOn = (type: Account["type"]) => accounts.filter((a) => a.account.type === type).reduce((t, a) => t + Math.max(0, a.balanceMinor), 0);
  const creditCardsMinor = owedOn("credit_card");
  const loansMinor = owedOn("loan");
  const creditBalancesMinor = accounts
    .filter((a) => (a.account.type === "credit_card" || a.account.type === "loan") && a.balanceMinor < 0)
    .reduce((t, a) => t - a.balanceMinor, 0);

  let receivablesMinor = 0;
  let borrowedMinor = 0;
  const people: PersonSummary[] = book.people.map((person) => {
    const owedToMe = bal(ledgerIds.receivable(person.id));
    const iOwe = -bal(ledgerIds.payable(person.id));
    receivablesMinor += owedToMe;
    borrowedMinor += iOwe;
    return {
      person,
      owedToMe: { originalMinor: 0, receivedMinor: 0, outstandingMinor: owedToMe },
      iOwe: { originalMinor: 0, repaidMinor: 0, outstandingMinor: iOwe },
    };
  });

  // Original / repaid per person come from the events that were actually applied.
  const byPerson = new Map(people.map((p) => [p.person.id, p]));
  for (const e of book.events) {
    if (e.date > asOf || !validIds.has(e.id)) continue;
    switch (e.type) {
      case "lend":
        add(byPerson.get(e.personId), "owedToMe", "originalMinor", e.amountMinor);
        break;
      case "reimbursable_expense":
        add(byPerson.get(e.personId), "owedToMe", "originalMinor", e.amountMinor);
        break;
      case "split_expense":
        for (const s of e.shares) add(byPerson.get(s.personId), "owedToMe", "originalMinor", s.amountMinor);
        break;
      case "repayment_received":
        add(byPerson.get(e.personId), "owedToMe", "receivedMinor", e.amountMinor);
        break;
      case "borrow":
        add(byPerson.get(e.personId), "iOwe", "originalMinor", e.amountMinor);
        break;
      case "repayment_made":
        add(byPerson.get(e.personId), "iOwe", "repaidMinor", e.amountMinor);
        break;
    }
  }

  const holdings: HoldingSummary[] = accounts
    .filter((a) => a.account.type === "investment")
    .map((a) => {
      const costBasisMinor = cost.get(a.account.id) ?? 0;
      return {
        account: a.account,
        valueMinor: a.balanceMinor,
        costBasisMinor,
        gainMinor: a.balanceMinor - costBasisMinor,
      };
    });

  const assetsTotal = cashMinor + investmentsMinor + receivablesMinor + creditBalancesMinor;
  const liabilitiesTotal = creditCardsMinor + loansMinor + borrowedMinor;

  return {
    asOf,
    accounts,
    cashMinor,
    assets: { totalMinor: assetsTotal, cashMinor, investmentsMinor, receivablesMinor, creditBalancesMinor },
    liabilities: {
      totalMinor: liabilitiesTotal,
      creditCardsMinor,
      loansMinor,
      borrowedMinor,
    },
    netWorthMinor: assetsTotal - liabilitiesTotal,
    investments: {
      valueMinor: investmentsMinor,
      costBasisMinor: holdings.reduce((t, h) => t + h.costBasisMinor, 0),
      gainMinor: holdings.reduce((t, h) => t + h.gainMinor, 0),
      holdings,
    },
    people,
  };
}

function add<K extends "owedToMe" | "iOwe">(
  summary: PersonSummary | undefined,
  side: K,
  field: keyof PersonSummary[K],
  amount: number,
) {
  if (!summary) return;
  (summary[side][field] as number) += amount;
}

/* ---------------- Period reports ---------------- */

export type CashFlowBucket = Exclude<FlowKind, "transfer" | "valuation" | "opening">;

export interface PeriodReport {
  from: string;
  to: string;
  /** Genuine income only: salary, interest... Not loans, repayments or sale proceeds. */
  incomeMinor: number;
  /** Genuine personal spending only: not transfers, card payments, loans, investments or other people's shares. */
  expensesMinor: number;
  savingsMinor: number;
  expensesByCategory: { categoryId: string; amountMinor: number }[];
  incomeByCategory: { categoryId: string; amountMinor: number }[];
  /**
   * Money that came back rather than was earned: refunds, reversals, cashback, reimbursements. Not part of
   * income; it reduces spending instead. expensesMinor is net of all of it; expensesByCategory is net of the
   * refunds matched to a purchase (see matchRefunds), so a refunded Amazon order no longer counts as Shopping.
   */
  refundsMinor: number;
  /** Investment gains recognised in the period (revaluations and sales). */
  investmentGainMinor: number;
  /** Real money movement through bank + cash, by purpose. */
  cashFlow: Record<CashFlowBucket, { inflowMinor: number; outflowMinor: number }>;
}

const emptyFlow = () => ({ inflowMinor: 0, outflowMinor: 0 });

function bucketOf(ledger: string, accountsById: Map<string, Account>): CashFlowBucket | null {
  if (ledger.startsWith("exp:")) return "expense";
  if (ledger.startsWith("inc:")) return "income";
  if (ledger.startsWith("recv:")) return "lending";
  if (ledger.startsWith("pay:")) return "borrowing";
  if (ledger.startsWith("gain:")) return "investment";
  if (ledger.startsWith("acct:")) {
    const account = accountsById.get(idOf(ledger));
    if (!account) return null;
    if (account.type === "investment") return "investment";
    if (account.type === "credit_card" || account.type === "loan") return "debt_payment";
  }
  return null;
}

/** Income categories that are money coming back, not earnings. */
export const MONEY_BACK_CATEGORY_IDS = new Set(["refund", "reimbursement"]);
export const MONEY_BACK_TEXT = /\b(refund\w*|reversal|reversed|rev|cashback|cash back|chargeback|\w*cradj\w*|credit adj\w*|reimb\w*|expense claim|claim settle\w*)\b/i;

/** Which money-back category an income entry's wording points to, if any. */
export function moneyBackCategoryOf(text: string): "refund" | "reimbursement" | null {
  if (!MONEY_BACK_TEXT.test(text)) return null;
  return /\b(reimb\w*|expense claim|claim settle\w*)\b/i.test(text) ? "reimbursement" : "refund";
}

/** An income entry that is really money coming back: by its category, or by what the bank printed. */
export function isMoneyBack(e: FinancialEvent): boolean {
  if (e.type !== "income") return false;
  if (MONEY_BACK_CATEGORY_IDS.has(e.categoryId)) return true;
  const text = [e.description, e.note, ...(e.sources ?? []).map((s) => s.narration)].filter(Boolean).join(" ");
  return MONEY_BACK_TEXT.test(text);
}

/** Words of a shop / company name, for comparing names the bank cut short ("Amazon Indi" vs "Amazon India"). */
const nameKey = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function sameParty(a: string | undefined, b: string | undefined): boolean {
  const x = nameKey(a);
  const y = nameKey(b);
  if (x.length < 4 || y.length < 4) return false;
  if (x === y || x.startsWith(y) || y.startsWith(x)) return true;
  const fx = x.split(" ")[0];
  return fx.length >= 4 && fx === y.split(" ")[0];
}

/** Refunds are only paired with purchases made up to this many days before them. */
const REFUND_WINDOW_DAYS = 120;
const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

export interface RefundMatch {
  refundId: string;
  expenseId: string;
  categoryId: string;
  amountMinor: number;
}

const refundCache = new WeakMap<FinancialEvent[], Map<string, RefundMatch>>();

/**
 * Pairs each refund with the purchase it gave back: same shop (names compared loosely, as banks shorten
 * them), made before the refund within REFUND_WINDOW_DAYS, and big enough to cover it. An exact amount
 * wins, then the closest date. One purchase can absorb several partial refunds up to its own amount.
 * Reimbursements and refunds with no matching purchase stay unpaired.
 */
export function matchRefunds(book: Book): Map<string, RefundMatch> {
  const cached = refundCache.get(book.events);
  if (cached) return cached;
  const left = new Map<string, number>();
  const purchases = book.events.filter((e): e is Extract<FinancialEvent, { type: "expense" }> => e.type === "expense");
  const refunds = book.events
    .filter((e): e is Extract<FinancialEvent, { type: "income" }> => isMoneyBack(e) && e.type === "income" && e.categoryId !== "reimbursement")
    .sort((a, b) => a.date.localeCompare(b.date));
  const out = new Map<string, RefundMatch>();
  for (const r of refunds) {
    const day = dayNumber(r.date);
    const candidates = purchases
      .filter((p) => p.date <= r.date && day - dayNumber(p.date) <= REFUND_WINDOW_DAYS && sameParty(p.description, r.description))
      .filter((p) => (left.get(p.id) ?? p.amountMinor) >= r.amountMinor)
      .sort((a, b) => Number(b.amountMinor === r.amountMinor) - Number(a.amountMinor === r.amountMinor) || b.date.localeCompare(a.date));
    const p = candidates[0];
    if (!p) continue;
    left.set(p.id, (left.get(p.id) ?? p.amountMinor) - r.amountMinor);
    out.set(r.id, { refundId: r.id, expenseId: p.id, categoryId: p.categoryId, amountMinor: r.amountMinor });
  }
  refundCache.set(book.events, out);
  return out;
}

export function periodReport(book: Book, ledger: Ledger, from: string, to: string): PeriodReport {
  const accountsById = new Map(book.accounts.map((a) => [a.id, a]));
  const moneyBack = new Set(book.events.filter(isMoneyBack).map((e) => e.id));
  const refundOf = matchRefunds(book);
  let refunds = 0;
  let unmatchedRefunds = 0;
  const expenses = new Map<string, number>();
  const income = new Map<string, number>();
  let gain = 0;
  const cashFlow: PeriodReport["cashFlow"] = {
    income: emptyFlow(),
    expense: emptyFlow(),
    lending: emptyFlow(),
    borrowing: emptyFlow(),
    debt_payment: emptyFlow(),
    investment: emptyFlow(),
  };

  const isCash = (ledgerId: string) => {
    if (!ledgerId.startsWith("acct:")) return false;
    const t = accountsById.get(idOf(ledgerId))?.type;
    return t === "bank" || t === "cash";
  };

  for (const entry of ledger.entries) {
    if (entry.date < from || entry.date > to || entry.kind === "opening") continue;

    for (const p of entry.postings) {
      if (p.ledger.startsWith("exp:")) {
        const id = idOf(p.ledger);
        expenses.set(id, (expenses.get(id) ?? 0) + p.amountMinor);
      } else if (p.ledger.startsWith("inc:") && moneyBack.has(entry.sourceId)) {
        refunds -= p.amountMinor;
        // A refund paired with a purchase comes off that purchase's category; the rest only off the total.
        const match = refundOf.get(entry.sourceId);
        if (match) expenses.set(match.categoryId, (expenses.get(match.categoryId) ?? 0) + p.amountMinor);
        else unmatchedRefunds -= p.amountMinor;
      } else if (p.ledger.startsWith("inc:")) {
        const id = idOf(p.ledger);
        income.set(id, (income.get(id) ?? 0) - p.amountMinor);
      } else if (p.ledger.startsWith("gain:")) {
        gain -= p.amountMinor;
      }
    }

    // Cash flow: whatever moved bank/cash money, attributed to the other side of the entry.
    const cashDelta = entry.postings.filter((p) => isCash(p.ledger)).reduce((t, p) => t + p.amountMinor, 0);
    if (cashDelta === 0) continue;
    for (const p of entry.postings) {
      if (isCash(p.ledger)) continue;
      const bucket = bucketOf(p.ledger, accountsById);
      if (!bucket) continue;
      const effectOnCash = -p.amountMinor;
      if (effectOnCash > 0) cashFlow[bucket].inflowMinor += effectOnCash;
      else cashFlow[bucket].outflowMinor += -effectOnCash;
    }
  }

  const sum = (m: Map<string, number>) => [...m.values()].reduce((t, v) => t + v, 0);
  const rows = (m: Map<string, number>) =>
    [...m.entries()]
      .filter(([, v]) => v !== 0)
      .map(([categoryId, amountMinor]) => ({ categoryId, amountMinor }))
      .sort((a, b) => b.amountMinor - a.amountMinor);

  const incomeMinor = sum(income);
  // Matched refunds are already taken off their categories above.
  const expensesMinor = sum(expenses) - unmatchedRefunds;
  return {
    from,
    to,
    incomeMinor,
    expensesMinor,
    savingsMinor: incomeMinor - expensesMinor,
    expensesByCategory: rows(expenses),
    incomeByCategory: rows(income),
    refundsMinor: refunds,
    investmentGainMinor: gain,
    cashFlow,
  };
}

/* ---------------- Spending rows (what the expense list shows) ---------------- */

export interface SpendingRow {
  eventId: string;
  date: string;
  categoryId: string;
  /** My own cost only: for a split bill this is my share, for a reimbursable expense there is no row. */
  amountMinor: number;
}

export function spendingRows(entries: LedgerEntry[]): SpendingRow[] {
  const rows: SpendingRow[] = [];
  for (const entry of entries) {
    for (const p of entry.postings) {
      if (p.ledger.startsWith("exp:") && p.amountMinor !== 0) {
        rows.push({ eventId: entry.sourceId, date: entry.date, categoryId: idOf(p.ledger), amountMinor: p.amountMinor });
      }
    }
  }
  return rows;
}

/** Sanity check used by tests: net worth must equal what income, spending and gains explain. */
export function netWorthFromEquity(ledger: Ledger, asOf: string): number {
  let total = 0;
  for (const entry of ledger.entries) {
    if (entry.date > asOf) continue;
    for (const p of entry.postings) {
      if (/^(exp|inc|gain|eq):/.test(p.ledger)) total -= p.amountMinor;
    }
  }
  return total;
}
