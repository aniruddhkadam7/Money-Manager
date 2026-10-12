import {
  CASH_ACCOUNT_TYPES,
  isAssetAccount,
  type Account,
  type AccountType,
  type Book,
  type EventIssue,
  type FinancialEvent,
  type FlowKind,
  type Ledger,
  type LedgerEntry,
  type Posting,
} from "./types";
import { fill, type Lot } from "./fifo";

/* ---------------- Ledger account ids ---------------- */

export const ledgerIds = {
  account: (id: string) => `acct:${id}`,
  receivable: (personId: string) => `recv:${personId}`,
  payable: (personId: string) => `pay:${personId}`,
  expense: (categoryId: string) => `exp:${categoryId}`,
  income: (categoryId: string) => `inc:${categoryId}`,
  OPENING: "eq:opening",
  REALIZED_GAIN: "gain:realized",
  UNREALIZED_GAIN: "gain:unrealized",
} as const;

export const idOf = (ledger: string) => ledger.slice(ledger.indexOf(":") + 1);

/* ---------------- Money helpers ---------------- */

/** Largest amount accepted for one entry: ₹1,00,000 crore in paise. Keeps every sum exactly representable. */
export const MAX_MINOR = 1_000_000_000_000;

/** round(a * b / c) using BigInt so large amounts can't lose precision. Half rounds up. */
export function mulDivRound(a: number, b: number, c: number): number {
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(c);
  return Number((num * 2n + den) / (2n * den));
}

const isWholeMoney = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);

export function isValidDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

/* ---------------- Errors ---------------- */

class EngineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const fail = (code: string, message: string): never => {
  throw new EngineError(code, message);
};

/* ---------------- Replay ---------------- */

interface Posted {
  flow: FlowKind;
  postings: Posting[];
  costDelta?: { accountId: string; deltaMinor: number };
  /** A stock order: the holding's open lots once it's applied. */
  lots?: { holdingId: string; lots: Lot[] };
}

interface ReplayState {
  /** Debit-positive running balance of every ledger account. */
  balance: Map<string, number>;
  /** Cost basis of each investment account. */
  cost: Map<string, number>;
  /** A stock holding's open lots, oldest first. */
  lots: Map<string, Lot[]>;
}

/** A stock holding (its name is the symbol, its style the product) is traded share by share, never by amount. */
const isStock = (a: Account) => a.type === "investment" && !!a.style;

const money = (n: number) => `₹${(n / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * Turns the user's events into a balanced ledger by replaying them in date order.
 *
 * Because everything is re-derived from the events, editing or deleting an
 * event automatically changes every number that depended on it. Events that
 * can't be applied (for example a repayment larger than what's owed) are
 * reported as issues and contribute nothing.
 */
export function buildLedger(book: Book): Ledger {
  const accounts = new Map<string, Account>(book.accounts.map((a) => [a.id, a]));
  const people = new Set(book.people.map((p) => p.id));
  const state: ReplayState = { balance: new Map(), cost: new Map(), lots: new Map() };
  const entries: LedgerEntry[] = [];
  const issues: EventIssue[] = [];

  const bal = (ledger: string) => state.balance.get(ledger) ?? 0;

  type Item =
    | { kind: "opening"; date: string; account: Account }
    | { kind: "event"; date: string; event: FinancialEvent };

  const items: Item[] = [
    ...book.accounts.map((account): Item => ({ kind: "opening", date: account.openedOn, account })),
    ...book.events.map((event): Item => ({ kind: "event", date: event.date, event })),
  ].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === "opening" ? -1 : 1; // opening balances first
    if (a.kind === "event" && b.kind === "event") {
      // Within a day, by time where there is one (stock orders), then in the order they were entered.
      const at = (e: FinancialEvent) => (e.type === "trade" ? (e.time ?? "") : "");
      return (
        at(a.event).localeCompare(at(b.event)) ||
        a.event.createdAt.localeCompare(b.event.createdAt) ||
        a.event.id.localeCompare(b.event.id)
      );
    }
    return 0;
  });

  /* --- validation helpers, bound to this book --- */

  const account = (id: string, allowed: AccountType[], role: string): Account => {
    const a = accounts.get(id);
    if (!a) return fail("unknown_account", `${role}: that account no longer exists.`);
    if (!allowed.includes(a.type)) {
      return fail("wrong_account_type", `${role}: “${a.name}” can't be used for this.`);
    }
    return a;
  };

  const person = (id: string, role = "Person") => {
    if (!people.has(id)) fail("unknown_person", `${role}: that person no longer exists.`);
  };

  const amount = (value: unknown, label = "Amount"): number => {
    if (!isWholeMoney(value) || value <= 0) fail("invalid_amount", `${label} must be more than zero.`);
    if ((value as number) > MAX_MINOR) fail("invalid_amount", `${label} is too large.`);
    return value as number;
  };

  const moneyAccounts: AccountType[] = CASH_ACCOUNT_TYPES;

  const notStock = (a: Account): Account =>
    isStock(a) ? fail("stock_holding", `“${a.name}” is a stock: record it as a Buy or Sell order with shares and price.`) : a;
  const spendAccounts: AccountType[] = ["bank", "cash", "credit_card"];

  /* --- one rule per event type: what changes, and how --- */

  const post = (e: FinancialEvent): Posted => {
    if (!isValidDate(e.date)) fail("invalid_date", "The date isn't valid.");

    switch (e.type) {
      case "expense": {
        const a = amount(e.amountMinor);
        const acct = account(e.accountId, spendAccounts, "Paid from");
        if (!e.categoryId) fail("missing_category", "Choose a category.");
        return {
          flow: "expense",
          postings: [
            { ledger: ledgerIds.expense(e.categoryId), amountMinor: a },
            { ledger: ledgerIds.account(acct.id), amountMinor: -a },
          ],
        };
      }

      case "income": {
        const a = amount(e.amountMinor);
        // Money back on a card (a refund, cashback) lowers what the card is owed, so a card can receive it too.
        const acct = account(e.accountId, [...moneyAccounts, "credit_card"], "Received in");
        if (!e.categoryId) fail("missing_category", "Choose a category.");
        return {
          flow: "income",
          postings: [
            { ledger: ledgerIds.account(acct.id), amountMinor: a },
            { ledger: ledgerIds.income(e.categoryId), amountMinor: -a },
          ],
        };
      }

      case "transfer": {
        const a = amount(e.amountMinor);
        const from = account(e.fromAccountId, moneyAccounts, "From");
        const to = account(e.toAccountId, ["bank", "cash", "credit_card", "loan"], "To");
        if (from.id === to.id) fail("same_account", "Choose two different accounts.");
        return {
          // Paying a card or loan is paying down debt, not spending.
          flow: to.type === "credit_card" || to.type === "loan" ? "debt_payment" : "transfer",
          postings: [
            { ledger: ledgerIds.account(to.id), amountMinor: a },
            { ledger: ledgerIds.account(from.id), amountMinor: -a },
          ],
        };
      }

      case "loan_taken": {
        const a = amount(e.amountMinor);
        const loan = account(e.fromAccountId, ["loan"], "Loan");
        const into = account(e.toAccountId, moneyAccounts, "Received in");
        // Borrowed money, not income: the account gains it and the loan owes the same.
        return {
          flow: "borrowing",
          postings: [
            { ledger: ledgerIds.account(into.id), amountMinor: a },
            { ledger: ledgerIds.account(loan.id), amountMinor: -a },
          ],
        };
      }

      case "emi_payment": {
        const a = amount(e.amountMinor, "EMI");
        const from = account(e.fromAccountId, moneyAccounts, "Paid from");
        const loan = account(e.toAccountId, ["loan"], "Loan");
        const interest = e.interestMinor;
        if (!isWholeMoney(interest) || interest < 0) fail("invalid_amount", "Interest can't be less than zero.");
        if (interest > a) fail("interest_exceeds_emi", "Interest can't be more than the whole EMI.");
        if (interest > 0 && !e.categoryId) fail("missing_category", "Choose a category.");
        const principal = a - interest;
        // The principal pays the loan down (not spending); only the interest is a cost.
        return {
          flow: "debt_payment",
          postings: [
            ...(principal > 0 ? [{ ledger: ledgerIds.account(loan.id), amountMinor: principal }] : []),
            ...(interest > 0 ? [{ ledger: ledgerIds.expense(e.categoryId), amountMinor: interest }] : []),
            { ledger: ledgerIds.account(from.id), amountMinor: -a },
          ],
        };
      }

      case "lend": {
        const a = amount(e.amountMinor);
        person(e.personId);
        // Lent before records began: they owe it, but no money leaves an account now.
        if (e.predatesRecords) {
          return {
            flow: "opening",
            postings: [
              { ledger: ledgerIds.receivable(e.personId), amountMinor: a },
              { ledger: ledgerIds.OPENING, amountMinor: -a },
            ],
          };
        }
        const acct = account(e.accountId, moneyAccounts, "Paid from");
        return {
          flow: "lending",
          postings: [
            { ledger: ledgerIds.receivable(e.personId), amountMinor: a },
            { ledger: ledgerIds.account(acct.id), amountMinor: -a },
          ],
        };
      }

      case "borrow": {
        const a = amount(e.amountMinor);
        person(e.personId);
        // Borrowed before records began: you owe it, but no money arrives in an account now.
        if (e.predatesRecords) {
          return {
            flow: "opening",
            postings: [
              { ledger: ledgerIds.payable(e.personId), amountMinor: -a },
              { ledger: ledgerIds.OPENING, amountMinor: a },
            ],
          };
        }
        const acct = account(e.accountId, moneyAccounts, "Received in");
        return {
          flow: "borrowing",
          postings: [
            { ledger: ledgerIds.account(acct.id), amountMinor: a },
            { ledger: ledgerIds.payable(e.personId), amountMinor: -a },
          ],
        };
      }

      case "repayment_received": {
        const a = amount(e.amountMinor);
        const acct = account(e.accountId, moneyAccounts, "Received in");
        person(e.personId);
        const owed = bal(ledgerIds.receivable(e.personId));
        const matched = Math.min(a, Math.max(owed, 0));
        const unmatched = a - matched;
        if (unmatched > 0 && !e.predatesRecords) {
          fail(
            "repayment_exceeds_outstanding",
            owed > 0
              ? `They only owe you ${money(owed)} at this point.`
              : "Nothing is owed to you by this person at this point.",
          );
        }
        // Any part with no recorded loan behind it is a claim from before tracking began: it joins opening equity.
        return {
          flow: "lending",
          postings: [
            { ledger: ledgerIds.account(acct.id), amountMinor: a },
            ...(matched > 0 ? [{ ledger: ledgerIds.receivable(e.personId), amountMinor: -matched }] : []),
            ...(unmatched > 0 ? [{ ledger: ledgerIds.OPENING, amountMinor: -unmatched }] : []),
          ],
        };
      }

      case "repayment_made": {
        const a = amount(e.amountMinor);
        const acct = account(e.accountId, moneyAccounts, "Paid from");
        person(e.personId);
        const owing = -bal(ledgerIds.payable(e.personId));
        const matched = Math.min(a, Math.max(owing, 0));
        const unmatched = a - matched;
        if (unmatched > 0 && !e.predatesRecords) {
          fail(
            "repayment_exceeds_outstanding",
            owing > 0
              ? `You only owe ${money(owing)} at this point.`
              : "You don't owe this person anything at this point.",
          );
        }
        return {
          flow: "borrowing",
          postings: [
            ...(matched > 0 ? [{ ledger: ledgerIds.payable(e.personId), amountMinor: matched }] : []),
            ...(unmatched > 0 ? [{ ledger: ledgerIds.OPENING, amountMinor: unmatched }] : []),
            { ledger: ledgerIds.account(acct.id), amountMinor: -a },
          ],
        };
      }

      case "split_expense": {
        const total = amount(e.totalMinor, "Total");
        const acct = account(e.accountId, spendAccounts, "Paid from");
        if (!e.categoryId) fail("missing_category", "Choose a category.");
        if (!Array.isArray(e.shares) || e.shares.length === 0) {
          fail("missing_shares", "Add who owes you a share.");
        }
        const owedByPerson = new Map<string, number>();
        for (const s of e.shares) {
          person(s.personId, "Share");
          const share = amount(s.amountMinor, "Each share");
          owedByPerson.set(s.personId, (owedByPerson.get(s.personId) ?? 0) + share);
        }
        const others = [...owedByPerson.values()].reduce((x, y) => x + y, 0);
        if (others > total) fail("shares_exceed_total", "Others' shares add up to more than the bill.");
        const mine = total - others;
        const postings: Posting[] = [];
        if (mine > 0) postings.push({ ledger: ledgerIds.expense(e.categoryId), amountMinor: mine });
        for (const [personId, share] of owedByPerson) {
          postings.push({ ledger: ledgerIds.receivable(personId), amountMinor: share });
        }
        postings.push({ ledger: ledgerIds.account(acct.id), amountMinor: -total });
        return { flow: "expense", postings };
      }

      case "reimbursable_expense": {
        const a = amount(e.amountMinor);
        const acct = account(e.accountId, spendAccounts, "Paid from");
        person(e.personId, "Reimbursed by");
        // Not my spending at all: it's money I'm owed back.
        return {
          flow: "lending",
          postings: [
            { ledger: ledgerIds.receivable(e.personId), amountMinor: a },
            { ledger: ledgerIds.account(acct.id), amountMinor: -a },
          ],
        };
      }

      case "invest": {
        const a = amount(e.amountMinor);
        const from = account(e.fromAccountId, moneyAccounts, "Paid from");
        const holding = notStock(account(e.holdingId, ["investment"], "Invest in"));
        return {
          flow: "investment",
          postings: [
            { ledger: ledgerIds.account(holding.id), amountMinor: a },
            { ledger: ledgerIds.account(from.id), amountMinor: -a },
          ],
          costDelta: { accountId: holding.id, deltaMinor: a },
        };
      }

      case "update_valuation": {
        const holding = notStock(account(e.holdingId, ["investment"], "Investment"));
        const value = e.valueMinor;
        if (!isWholeMoney(value) || value < 0 || value > MAX_MINOR) {
          fail("invalid_amount", "Enter the current value (zero or more).");
        }
        const diff = value - bal(ledgerIds.account(holding.id));
        // A value change is a gain or loss: it changes net worth but moves no cash.
        return {
          flow: "valuation",
          postings:
            diff === 0
              ? []
              : [
                  { ledger: ledgerIds.account(holding.id), amountMinor: diff },
                  { ledger: ledgerIds.UNREALIZED_GAIN, amountMinor: -diff },
                ],
        };
      }

      case "sell_investment": {
        const proceeds = amount(e.proceedsMinor, "Sale amount");
        const to = account(e.toAccountId, moneyAccounts, "Received in");
        const holding = notStock(account(e.holdingId, ["investment"], "Investment"));
        const ledgerId = ledgerIds.account(holding.id);
        const value = bal(ledgerId);
        const cost = state.cost.get(holding.id) ?? 0;
        if (value <= 0) fail("nothing_to_sell", "There's nothing left in this investment to sell.");

        const sold = e.soldValueMinor ?? value;
        if (!isWholeMoney(sold) || sold <= 0) fail("invalid_amount", "Value sold must be more than zero.");
        if (sold > value) {
          fail("sell_exceeds_holding", `You only hold ${money(value)} of this investment at this point.`);
        }

        // The cost behind the part being sold, proportional to the share of the holding sold.
        const costSold = sold === value ? cost : mulDivRound(cost, sold, value);
        const realized = proceeds - costSold; // the true gain/loss on what was sold
        const alreadyRecorded = sold - costSold; // gain/loss already booked via revaluations

        return {
          flow: "investment",
          postings: [
            { ledger: ledgerIds.account(to.id), amountMinor: proceeds },
            { ledger: ledgerId, amountMinor: -sold },
            { ledger: ledgerIds.REALIZED_GAIN, amountMinor: -realized },
            { ledger: ledgerIds.UNREALIZED_GAIN, amountMinor: alreadyRecorded },
          ].filter((p) => p.amountMinor !== 0),
          costDelta: { accountId: holding.id, deltaMinor: -costSold },
        };
      }

      case "trade": {
        const holding = account(e.holdingId, ["investment"], "Stock");
        if (!isStock(holding)) fail("not_a_stock", `“${holding.name}” isn't a stock holding.`);
        const buy = e.side === "buy";
        if (!buy && e.side !== "sell") fail("invalid_side", "Choose Buy or Sell.");
        const cash = account(e.accountId, moneyAccounts, buy ? "Paid from" : "Received in");
        if (!Number.isSafeInteger(e.quantity) || e.quantity <= 0) fail("invalid_quantity", "Quantity must be a whole number of shares.");
        const price = amount(e.priceMinor, "Price");
        const charges = e.chargesMinor ?? 0;
        if (!isWholeMoney(charges) || charges < 0 || charges > MAX_MINOR) fail("invalid_amount", "Charges must be zero or more.");
        const value = e.quantity * price;
        if (value > MAX_MINOR) fail("invalid_amount", "That order is too large.");
        if (e.time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(e.time)) fail("invalid_time", "The time isn't valid.");

        const side = buy ? 1 : -1;
        const lots = state.lots.get(holding.id) ?? [];
        const f = fill(lots, side, e.quantity, price);
        // Delivery (CNC) can't be sold before it's bought; only intraday (MIS) can go short.
        if (!buy && f.openedQuantity > 0 && holding.style === "delivery") {
          const held = f.closedQuantity;
          fail("sell_exceeds_holding", held > 0 ? `You hold only ${held} ${holding.name} (CNC) at that time.` : `You don't hold any ${holding.name} (CNC) at that time.`);
        }
        // The holding is carried at what its open shares cost: new shares at this price, closed ones at theirs.
        const holdingDelta = side * (f.openedQuantity * price + f.closedCostMinor);
        // The profit on closed shares, less this order's charges, is the trade's realized gain (a credit).
        const gain = f.grossMinor - charges;
        return {
          flow: "investment",
          postings: [
            { ledger: ledgerIds.account(cash.id), amountMinor: buy ? -(value + charges) : value - charges },
            { ledger: ledgerIds.account(holding.id), amountMinor: holdingDelta },
            { ledger: ledgerIds.REALIZED_GAIN, amountMinor: -gain },
          ].filter((p) => p.amountMinor !== 0),
          costDelta: { accountId: holding.id, deltaMinor: holdingDelta },
          lots: { holdingId: holding.id, lots: f.lots },
        };
      }
    }
  };

  /* --- apply --- */

  const record = (entry: LedgerEntry) => {
    const sum = entry.postings.reduce((t, p) => t + p.amountMinor, 0);
    if (sum !== 0) throw new Error(`Unbalanced entry for ${entry.sourceId}`); // an engine bug, never user input
    for (const p of entry.postings) state.balance.set(p.ledger, bal(p.ledger) + p.amountMinor);
    if (entry.costDelta) {
      const { accountId, deltaMinor } = entry.costDelta;
      state.cost.set(accountId, (state.cost.get(accountId) ?? 0) + deltaMinor);
    }
    entries.push(entry);
  };

  for (const item of items) {
    if (item.kind === "opening") {
      const a = item.account;
      const sourceId = `opening:${a.id}`;
      try {
        if (!isValidDate(a.openedOn)) fail("invalid_date", `“${a.name}” has an invalid start date.`);
        if (!isWholeMoney(a.openingBalanceMinor) || a.openingBalanceMinor < 0 || a.openingBalanceMinor > MAX_MINOR) {
          fail("invalid_amount", `“${a.name}” has an invalid starting balance.`);
        }
        if (a.openingBalanceMinor === 0) continue;
        if (isStock(a)) fail("stock_holding", `“${a.name}” is a stock: its shares come from its Buy and Sell orders.`);
        const o = a.openingBalanceMinor;
        const asset = isAssetAccount(a.type);
        record({
          sourceId,
          kind: "opening",
          date: a.openedOn,
          flow: "opening",
          postings: [
            { ledger: ledgerIds.account(a.id), amountMinor: asset ? o : -o },
            { ledger: ledgerIds.OPENING, amountMinor: asset ? -o : o },
          ],
          costDelta: a.type === "investment" ? { accountId: a.id, deltaMinor: o } : undefined,
        });
      } catch (err) {
        if (!(err instanceof EngineError)) throw err;
        issues.push({ eventId: sourceId, code: err.code, message: err.message });
      }
      continue;
    }

    const e = item.event;
    try {
      const { lots, ...posted } = post(e);
      record({ sourceId: e.id, kind: e.type, date: e.date, ...posted });
      if (lots) state.lots.set(lots.holdingId, lots.lots);
    } catch (err) {
      if (!(err instanceof EngineError)) throw err;
      issues.push({ eventId: e.id, code: err.code, message: err.message });
    }
  }

  return { entries, issues };
}
