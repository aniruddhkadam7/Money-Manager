/**
 * The financial model.
 *
 * Users record real-world EVENTS ("I borrowed ₹20,000 from Rahul"). The engine
 * turns each event into balanced ledger postings and everything else (balances,
 * net worth, spending, cash flow) is derived. Nothing derived is ever stored.
 *
 * All amounts are integer paise.
 */

/* ---------------- Accounts & people ---------------- */

export type AccountType = "bank" | "cash" | "credit_card" | "loan" | "investment";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /**
   * What the account held (or, for credit cards / loans, what was owed) when
   * tracking began. Always >= 0; the account type says which direction it is.
   */
  openingBalanceMinor: number;
  /** The day the opening balance counts from (`YYYY-MM-DD`). */
  openedOn: string;
  createdAt: string;
}

export interface Person {
  id: string;
  name: string;
  createdAt: string;
}

export const ASSET_ACCOUNT_TYPES: AccountType[] = ["bank", "cash", "investment"];
export const LIABILITY_ACCOUNT_TYPES: AccountType[] = ["credit_card", "loan"];
/** Accounts that hold spendable money. */
export const CASH_ACCOUNT_TYPES: AccountType[] = ["bank", "cash"];
/** Accounts a statement can be imported into: bank and cash statements, and credit card statements. */
export const STATEMENT_ACCOUNT_TYPES: AccountType[] = ["bank", "cash", "credit_card"];

export const isAssetAccount = (type: AccountType) => ASSET_ACCOUNT_TYPES.includes(type);
export const isLiabilityAccount = (type: AccountType) => LIABILITY_ACCOUNT_TYPES.includes(type);

/* ---------------- Events ---------------- */

/** Where an entry came from, when it was created or confirmed by a bank statement import. */
export interface EventSource {
  kind: "statement";
  importId: string;
  rowId: string;
  filename: string;
  /** Position in the statement. */
  line: number;
  /** The line exactly as the bank printed it (lets later features spot things like auto-debits). */
  narration?: string;
  /** The line's identity (account, day, direction, amount, reference), so the same line is recognised if it is uploaded again. */
  fingerprint?: string;
  /** "created": the import made this entry. "matched": it already existed and the statement confirmed it. */
  role: "created" | "matched";
}

interface EventBase {
  id: string;
  /** Bank statement lines this entry came from or was confirmed by. */
  sources?: EventSource[];
  /** When it happened (`YYYY-MM-DD`, user's local date). */
  date: string;
  description?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

/** I spent money. */
export interface ExpenseEvent extends EventBase {
  type: "expense";
  accountId: string;
  amountMinor: number;
  categoryId: string;
}

/** I received income (salary, interest...). */
export interface IncomeEvent extends EventBase {
  type: "income";
  accountId: string;
  amountMinor: number;
  categoryId: string;
}

/** Money moved between my own accounts, including paying a card or loan. */
export interface TransferEvent extends EventBase {
  type: "transfer";
  fromAccountId: string;
  toAccountId: string;
  amountMinor: number;
}

/** I lent money to someone. */
export interface LendEvent extends EventBase {
  type: "lend";
  personId: string;
  accountId: string;
  amountMinor: number;
}

/** I borrowed money from someone. */
export interface BorrowEvent extends EventBase {
  type: "borrow";
  personId: string;
  accountId: string;
  amountMinor: number;
}

/** Someone paid me back (a loan, their share of a bill, a reimbursement). */
export interface RepaymentReceivedEvent extends EventBase {
  type: "repayment_received";
  personId: string;
  accountId: string;
  amountMinor: number;
  /** The loan this settles was before records began (or in cash), so it may exceed what is recorded. */
  predatesRecords?: boolean;
}

/** I paid back money I borrowed. */
export interface RepaymentMadeEvent extends EventBase {
  type: "repayment_made";
  personId: string;
  accountId: string;
  amountMinor: number;
  /** The loan this settles was before records began (or in cash), so it may exceed what is recorded. */
  predatesRecords?: boolean;
}

/** I paid a bill; other people owe me their shares. Only my own share is spending. */
export interface SplitExpenseEvent extends EventBase {
  type: "split_expense";
  accountId: string;
  /** What I actually paid. */
  totalMinor: number;
  categoryId: string;
  /** What other people owe me. My share is total minus these. */
  shares: { personId: string; amountMinor: number }[];
}

/** I paid for something that someone (e.g. my company) will pay back in full. */
export interface ReimbursableExpenseEvent extends EventBase {
  type: "reimbursable_expense";
  accountId: string;
  amountMinor: number;
  categoryId: string;
  personId: string;
}

/** I put money into an investment. */
export interface InvestEvent extends EventBase {
  type: "invest";
  fromAccountId: string;
  /** An account of type `investment`. */
  holdingId: string;
  amountMinor: number;
}

/** I sold (all or part of) an investment. */
export interface SellInvestmentEvent extends EventBase {
  type: "sell_investment";
  holdingId: string;
  toAccountId: string;
  /** Cash I received. */
  proceedsMinor: number;
  /** Current value of the part sold. Omit to sell the whole holding. */
  soldValueMinor?: number;
}

/** An investment is now worth this much (sets the value; the engine records the gain/loss). */
export interface UpdateValuationEvent extends EventBase {
  type: "update_valuation";
  holdingId: string;
  valueMinor: number;
}

export type FinancialEvent =
  | ExpenseEvent
  | IncomeEvent
  | TransferEvent
  | LendEvent
  | BorrowEvent
  | RepaymentReceivedEvent
  | RepaymentMadeEvent
  | SplitExpenseEvent
  | ReimbursableExpenseEvent
  | InvestEvent
  | SellInvestmentEvent
  | UpdateValuationEvent;

export type EventType = FinancialEvent["type"];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What the UI submits: an event without bookkeeping fields. */
export type EventDraft = DistributiveOmit<FinancialEvent, "id" | "createdAt" | "updatedAt">;

/** Everything the engine needs. The whole financial picture derives from this. */
export interface Book {
  accounts: Account[];
  people: Person[];
  events: FinancialEvent[];
  /** Bookkeeping about the book itself, not money. */
  setup?: {
    /** The standard accounts (Cash, UPI, cards...) were offered once. */
    defaultAccountsAdded: boolean;
    /** Which version of the standard set was offered, so new standard accounts can be added once later. */
    defaultsVersion?: number;
  };
}

/* ---------------- Ledger ---------------- */

/**
 * Ledger account ids:
 *   acct:<id>   a user account (bank, cash, card, loan, investment)
 *   recv:<id>   money a person owes me           (asset)
 *   pay:<id>    money I owe a person             (liability)
 *   exp:<cat>   spending in a category           (expense)
 *   inc:<cat>   income in a category             (income)
 *   gain:*      investment gains                 (gain)
 *   eq:opening  opening balances                 (equity)
 */
export type LedgerAccountId = string;

/** Positive = debit, negative = credit. Every entry's postings sum to exactly zero. */
export interface Posting {
  ledger: LedgerAccountId;
  amountMinor: number;
}

/** How an entry moves money, for cash-flow reporting. */
export type FlowKind =
  | "income"
  | "expense"
  | "lending"
  | "borrowing"
  | "debt_payment"
  | "investment"
  | "transfer"
  | "valuation"
  | "opening";

export interface LedgerEntry {
  /** The event that produced this entry; opening balances use `opening:<accountId>`. */
  sourceId: string;
  kind: EventType | "opening";
  date: string;
  flow: FlowKind;
  postings: Posting[];
  /** Change to an investment's cost basis (what I paid in, less what's been sold). */
  costDelta?: { accountId: string; deltaMinor: number };
}

export interface EventIssue {
  eventId: string;
  code: string;
  message: string;
}

export interface Ledger {
  entries: LedgerEntry[];
  /** Events the engine refused to apply. They have no effect on any number. */
  issues: EventIssue[];
}
