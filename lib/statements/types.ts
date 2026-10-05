/**
 * Bank-statement import: shared types.
 *
 * Principle: the statement is evidence, the finance engine is the source of truth.
 * Nothing here changes a balance; rows become ordinary engine events only at commit.
 */

export type Direction = "debit" | "credit";

export type ImportStatus = "UPLOADED" | "PROCESSING" | "REVIEW_REQUIRED" | "READY_TO_IMPORT" | "IMPORTED" | "FAILED";

/** What a statement line means financially. AI and rules both speak this vocabulary. */
export type StatementEventType =
  | "EXPENSE"
  | "INCOME"
  | "TRANSFER"
  | "MONEY_LENT"
  | "MONEY_BORROWED"
  | "LENDING_REPAYMENT"
  | "BORROWING_REPAYMENT"
  | "SPLIT_EXPENSE"
  | "REIMBURSEMENT"
  | "INVESTMENT"
  | "INVESTMENT_SELL"
  | "ASSET_PURCHASE"
  | "ASSET_SALE"
  | "LOAN_TAKEN"
  | "LOAN_REPAYMENT"
  | "CREDIT_CARD_PAYMENT";

export const ALL_EVENT_TYPES: StatementEventType[] = [
  "EXPENSE", "INCOME", "TRANSFER", "MONEY_LENT", "MONEY_BORROWED", "LENDING_REPAYMENT", "BORROWING_REPAYMENT",
  "SPLIT_EXPENSE", "REIMBURSEMENT", "INVESTMENT", "INVESTMENT_SELL", "ASSET_PURCHASE", "ASSET_SALE",
  "LOAN_TAKEN", "LOAN_REPAYMENT", "CREDIT_CARD_PAYMENT",
];

/** Which direction of money each event type can have. TRANSFER works both ways. */
export const EVENT_DIRECTIONS: Record<StatementEventType, Direction[]> = {
  EXPENSE: ["debit"],
  INCOME: ["credit"],
  TRANSFER: ["debit", "credit"],
  MONEY_LENT: ["debit"],
  MONEY_BORROWED: ["credit"],
  LENDING_REPAYMENT: ["credit"],
  BORROWING_REPAYMENT: ["debit"],
  SPLIT_EXPENSE: ["debit"],
  REIMBURSEMENT: ["debit", "credit"],
  INVESTMENT: ["debit"],
  INVESTMENT_SELL: ["credit"],
  ASSET_PURCHASE: ["debit"],
  ASSET_SALE: ["credit"],
  LOAN_TAKEN: ["credit"],
  LOAN_REPAYMENT: ["debit"],
  CREDIT_CARD_PAYMENT: ["debit"],
};

/** Events whose meaning depends on another person: never auto-processed on a guess alone. */
export const PERSON_EVENTS: StatementEventType[] = [
  "MONEY_LENT", "MONEY_BORROWED", "LENDING_REPAYMENT", "BORROWING_REPAYMENT", "REIMBURSEMENT", "SPLIT_EXPENSE",
];

/** Events the importer can turn into engine events today. */
export const SUPPORTED_EVENT_TYPES: StatementEventType[] = [
  "EXPENSE", "INCOME", "TRANSFER", "MONEY_LENT", "MONEY_BORROWED", "LENDING_REPAYMENT", "BORROWING_REPAYMENT",
  "REIMBURSEMENT", "INVESTMENT", "INVESTMENT_SELL", "LOAN_REPAYMENT", "CREDIT_CARD_PAYMENT",
];

/* ---------------- Extraction ---------------- */

/** One positioned piece of text from a PDF page (or OCR). */
export interface TextItem {
  str: string;
  /** Left edge. */
  x: number;
  /** Baseline; larger = higher on the page. */
  y: number;
  width: number;
  height: number;
  page: number;
}

/** A transaction line exactly as read from the statement, before any interpretation. */
export interface RawRow {
  /** Order in the statement, after any reordering to oldest-first. */
  index: number;
  page: number;
  /** Where the line sits on the page (PDF units from the bottom), so the original can be opened right there. */
  y?: number;
  date: string;
  valueDate?: string;
  rawDescription: string;
  debitMinor: number;
  creditMinor: number;
  balanceMinor?: number;
  reference?: string;
  /** 0..1: how sure we are the line was read correctly. */
  confidence: number;
  rawLine: string;
  warnings: string[];
}

export interface ParsedStatement {
  parser: string;
  rows: RawRow[];
  openingBalanceMinor?: number;
  /** True when the opening balance was worked back from the first line rather than printed (so it can't verify anything). */
  openingDerived?: boolean;
  closingBalanceMinor?: number;
  periodStart?: string;
  periodEnd?: string;
  /** Last digits of the account number, if printed. */
  accountMask?: string;
  bankHint?: string;
  warnings: string[];
  ocr: boolean;
}

export class StatementError extends Error {
  constructor(
    public readonly code:
      | "invalid_pdf"
      | "password_required"
      | "password_incorrect"
      | "unsupported_format"
      | "no_transactions"
      | "ocr_failed"
      | "duplicate_file",
    message: string,
    /** For duplicate_file: the earlier import of the same file. */
    public readonly importId?: string,
  ) {
    super(message);
    this.name = "StatementError";
  }
}

/* ---------------- Interpretation ---------------- */

export interface Normalized {
  /** UPI / NEFT / IMPS / RTGS / ATM / POS / ACH / CHQ ... when recognisable. */
  mode: string | null;
  reference: string | null;
  vpa: string | null;
  /** Readable counterparty: "Swiggy", "Rahul Sharma". */
  counterparty: string;
  /** Lowercase matching key: "swiggy", "rahul sharma". */
  counterpartyKey: string;
  /** Cleaned text used for comparison (never replaces the raw description). */
  text: string;
}

export interface Classification {
  source: "user_rule" | "rule" | "relationship" | "ai" | "user";
  eventType: StatementEventType;
  /** Category name or id (mapped to the app's categories at planning time). */
  category: string | null;
  merchant: string | null;
  person: string | null;
  /** The other account for transfers, card payments and loan repayments. */
  counterAccountId: string | null;
  /** Investment name for INVESTMENT / INVESTMENT_SELL. */
  holding: string | null;
  confidence: number;
  reason: string;
  /** A weak default that the AI may improve on (when it is available). */
  tentative?: boolean;
  /** Other plausible meanings, shown to the user as quick options. */
  alternatives: StatementEventType[];
}

export type MatchKind =
  | "existing_event" // same transaction already in the ledger
  | "previous_import" // same line imported from another statement
  | "possible_existing" // looks like an existing entry but not sure
  | "possible_in_statement" // looks like another line in this statement
  | "in_statement_duplicate"; // the same line read twice

export interface RowMatch {
  kind: MatchKind;
  /** 1 = exact, 2 = strong, 3 = possible. */
  level: 1 | 2 | 3;
  eventId?: string;
  otherRowId?: string;
  score: number;
  reason: string;
}

export type RowStatus =
  | "pending"
  | "auto" // confident: will be imported
  | "auto_flagged" // fairly confident: will be imported, worth a glance
  | "review" // needs the user
  | "matched_existing" // linked to an entry that already exists
  | "already_imported" // seen in an earlier statement
  | "possible_duplicate" // needs the user to say same / different
  | "skipped" // user chose not to import
  | "imported"
  | "failed";

export interface StatementRow {
  id: string;
  importId: string;
  index: number;
  sourcePage: number;
  sourceY?: number;
  transactionDate: string;
  valueDate?: string;
  /** Exactly as printed by the bank. Never modified. */
  rawDescription: string;
  normalizedDescription: string;
  debitMinor: number;
  creditMinor: number;
  /** Always positive. */
  amountMinor: number;
  direction: Direction;
  balanceAfterMinor?: number;
  referenceNumber?: string;
  accountId: string;
  extractionConfidence: number;
  rawData: { line: string; warnings: string[] };
  normalized: Normalized;
  /** Identity of this transaction independent of which statement it came from. */
  fingerprint: string;
  /** 0 for the first line with this fingerprint in the statement, 1 for the next identical one, ... */
  occurrence: number;
  status: RowStatus;
  classification?: Classification;
  match?: RowMatch;
  decision?: { by: "auto" | "user"; at: string; note?: string };
  /** Event created from (or matched to) this line. */
  eventId?: string;
  error?: string;
}

/* ---------------- Reconciliation ---------------- */

export interface ReconIssue {
  kind: "balance_mismatch" | "balance_jump" | "invalid_date" | "invalid_amount" | "no_totals" | "date_out_of_period" | "duplicate_row" | "low_confidence";
  rowIndex?: number;
  message: string;
}

export interface Reconciliation {
  /** True only when the statement's own figures add up. */
  ok: boolean;
  /** False when the statement gave no balances to check against. */
  verifiable: boolean;
  openingMinor?: number;
  totalDebitsMinor: number;
  totalCreditsMinor: number;
  expectedClosingMinor?: number;
  actualClosingMinor?: number;
  differenceMinor?: number;
  issues: ReconIssue[];
}

/* ---------------- Import record, rules, settings ---------------- */

export interface ImportCounts {
  transactions: number;
  imported: number;
  matchedExisting: number;
  alreadyImported: number;
  duplicates: number;
  possibleDuplicates: number;
  auto: number;
  autoFlagged: number;
  review: number;
  skipped: number;
  errors: number;
}

export interface ImportRecord {
  id: string;
  filename: string;
  fileHash: string;
  accountId: string;
  bankHint?: string;
  accountMask?: string;
  periodStart?: string;
  periodEnd?: string;
  uploadedAt: string;
  status: ImportStatus;
  parser?: string;
  ocr: boolean;
  openingBalanceMinor?: number;
  closingBalanceMinor?: number;
  reconciliation?: Reconciliation;
  /** The person accepted a reconciliation problem and wants to import anyway. */
  reconciliationOverride?: boolean;
  counts: ImportCounts;
  aiUsed: boolean;
  aiNote?: string;
  error?: string;
  importedAt?: string;
}

/** What the person taught us: "this counterparty, in this direction, means that". */
export interface UserRule {
  id: string;
  key: string;
  direction: Direction;
  eventType: StatementEventType;
  category: string | null;
  person: string | null;
  counterAccountId: string | null;
  holding: string | null;
  confirmations: number;
  contradictions: number;
  updatedAt: string;
  /** The person said "always": trusted fully, applied to every waiting line and every future statement. */
  always?: boolean;
}

export interface ImportSettings {
  /** At or above: processed without asking. */
  autoThreshold: number;
  /** At or above (and below auto): processed, but flagged for a glance. Below: must be reviewed. */
  reviewThreshold: number;
  useAi: boolean;
}

export const DEFAULT_SETTINGS: ImportSettings = { autoThreshold: 0.95, reviewThreshold: 0.8, useAi: true };

export interface AiCacheEntry {
  eventType: StatementEventType;
  category: string | null;
  merchant: string | null;
  confidence: number;
  reason: string;
  at: string;
}

export interface ImportStoreData {
  version: 1;
  imports: ImportRecord[];
  rows: StatementRow[];
  rules: UserRule[];
  settings: ImportSettings;
  /** Cached AI answers for merchants (never for people), keyed by direction + counterparty. */
  aiCache: Record<string, AiCacheEntry>;
  /** Which account was last used for a bank/mask, to preselect next time. */
  accountByMask: Record<string, string>;
}

export const emptyImportStore = (): ImportStoreData => ({
  version: 1,
  imports: [],
  rows: [],
  rules: [],
  settings: { ...DEFAULT_SETTINGS },
  aiCache: {},
  accountByMask: {},
});
