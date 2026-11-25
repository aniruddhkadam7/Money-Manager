import { ledgerIds } from "./engine";
import type { FinancialState } from "./state";
import type { BalancePoint } from "./series";
import type { ImportRecord } from "@/lib/statements/types";
import type { AccountType, Book, Ledger } from "./types";

/**
 * What a bank or cash statement says the account held at its end: the printed closing balance, or, when the
 * statement prints none (ICICI), the running balance after its last line.
 */
export function statementClosing(record: ImportRecord, type: AccountType | undefined): number | undefined {
  if (record.closingBalanceMinor != null) return record.closingBalanceMinor;
  return type === "bank" || type === "cash" ? record.reconciliation?.actualClosingMinor : undefined;
}

/** A bank statement's word on what an account held at the end of a day. */
export interface BalanceAnchor {
  accountId: string;
  /** Last day the statement covers (`YYYY-MM-DD`). */
  date: string;
  closingMinor: number;
}

/** What the app's entries are missing for an account: the statement's closing balance less what they say it should be. */
export interface AnchorGap {
  accountId: string;
  date: string;
  gapMinor: number;
}

/**
 * What a bank or cash account's statement should show at the end of `date`, by the app's entries: its balance
 * then, leaving out entries marked as not in a statement.
 */
export function statementBalanceAt(book: Book, ledger: Ledger, accountId: string, date: string): number {
  const off = new Set(book.events.filter((e) => e.offStatement).map((e) => e.id));
  const id = ledgerIds.account(accountId);
  let total = 0;
  for (const entry of ledger.entries) {
    if (entry.date > date || off.has(entry.sourceId)) continue;
    for (const p of entry.postings) if (p.ledger === id) total += p.amountMinor;
  }
  return total;
}

/**
 * The bank is the source of truth for bank and cash balances: for each statement, how far the app's own balance
 * on the statement's last day is from the statement's closing balance. Entries marked as not in a statement don't
 * count towards that day's balance, so they end up on top of the statement's. A statement that agrees gives a gap
 * of 0, which still counts: it settles the balance for the days around it (see gapAt). Unless `keepZero`, those are
 * left out (nothing to add).
 */
export function anchorGaps(book: Book, ledger: Ledger, anchors: BalanceAnchor[], keepZero = false): AnchorGap[] {
  const out: AnchorGap[] = [];
  for (const a of anchors) {
    const type = book.accounts.find((x) => x.id === a.accountId)?.type;
    if (type !== "bank" && type !== "cash") continue;
    const app = statementBalanceAt(book, ledger, a.accountId, a.date);
    if (keepZero || a.closingMinor !== app) out.push({ accountId: a.accountId, date: a.date, gapMinor: a.closingMinor - app });
  }
  return out;
}

/**
 * What to add to an account's recorded balance at the end of `date`: the gap of its latest statement up to that
 * day, so the balance is that statement's closing plus what's recorded since. Before its first statement, that
 * first statement's gap, so the balance is worked back from it (its closing less what's recorded in between)
 * rather than left to the entries alone, which miss whatever happened before you started recording.
 */
export function gapAt(gaps: AnchorGap[], accountId: string, date: string): number {
  let before: AnchorGap | null = null;
  let after: AnchorGap | null = null;
  for (const g of gaps) {
    if (g.accountId !== accountId) continue;
    if (g.date <= date) {
      if (!before || g.date > before.date) before = g;
    } else if (!after || g.date < after.date) after = g;
  }
  return (before ?? after)?.gapMinor ?? 0;
}

/** The gaps' total for every account with a statement, at the end of `date`. */
function totalGapAt(gaps: AnchorGap[], date: string): number {
  let total = 0;
  for (const id of new Set(gaps.map((g) => g.accountId))) total += gapAt(gaps, id, date);
  return total;
}

/**
 * The state with each account's balance going by its statements (see gapAt): the latest one up to `state.asOf`
 * plus everything recorded after it, or, before the first, worked back from it. Totals (bank & cash, assets, net
 * worth) move with it so every page shows the same figures.
 */
export function applyAnchorGaps(state: FinancialState, gaps: AnchorGap[]): FinancialState {
  const gapOf = new Map<string, number>();
  for (const id of new Set(gaps.map((g) => g.accountId))) {
    const gap = gapAt(gaps, id, state.asOf);
    if (gap !== 0) gapOf.set(id, gap);
  }
  if (gapOf.size === 0) return state;
  const total = [...gapOf.values()].reduce((t, g) => t + g, 0);
  return {
    ...state,
    accounts: state.accounts.map((a) => (gapOf.has(a.account.id) ? { ...a, balanceMinor: a.balanceMinor + gapOf.get(a.account.id)! } : a)),
    cashMinor: state.cashMinor + total,
    assets: { ...state.assets, cashMinor: state.assets.cashMinor + total, totalMinor: state.assets.totalMinor + total },
    netWorthMinor: state.netWorthMinor + total,
  };
}

/** A balance history on the same footing, each day going by the statements as applyAnchorGaps does. */
export function applyAnchorGapsToSeries(points: BalancePoint[], gaps: AnchorGap[]): BalancePoint[] {
  if (gaps.length === 0) return points;
  return points.map((p) => {
    const add = totalGapAt(gaps, p.date);
    return add === 0 ? p : { ...p, netWorthMinor: p.netWorthMinor + add, assetsMinor: p.assetsMinor + add };
  });
}
