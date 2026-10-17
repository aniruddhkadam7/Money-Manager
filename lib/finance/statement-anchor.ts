import { ledgerIds } from "./engine";
import type { FinancialState } from "./state";
import type { BalancePoint } from "./series";
import type { Book, Ledger } from "./types";

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
 * The bank is the source of truth for bank and cash balances: for each account with a statement, how far the
 * app's own balance on the statement's last day is from the statement's closing balance. Entries marked as not
 * in a statement don't count towards that day's balance, so they end up on top of the statement's. Zero gaps
 * are left out.
 */
export function anchorGaps(book: Book, ledger: Ledger, anchors: BalanceAnchor[]): AnchorGap[] {
  const out: AnchorGap[] = [];
  for (const a of anchors) {
    const type = book.accounts.find((x) => x.id === a.accountId)?.type;
    if (type !== "bank" && type !== "cash") continue;
    const app = statementBalanceAt(book, ledger, a.accountId, a.date);
    if (a.closingMinor !== app) out.push({ accountId: a.accountId, date: a.date, gapMinor: a.closingMinor - app });
  }
  return out;
}

/**
 * The state with each account's balance starting from its latest statement: the closing balance plus everything
 * recorded after it. Totals (bank & cash, assets, net worth) move with it so every page shows the same figures.
 * A statement dated after `state.asOf` doesn't apply yet.
 */
export function applyAnchorGaps(state: FinancialState, gaps: AnchorGap[]): FinancialState {
  const live = gaps.filter((g) => g.date <= state.asOf);
  if (live.length === 0) return state;
  const gapOf = new Map(live.map((g) => [g.accountId, g.gapMinor]));
  const total = live.reduce((t, g) => t + g.gapMinor, 0);
  return {
    ...state,
    accounts: state.accounts.map((a) => (gapOf.has(a.account.id) ? { ...a, balanceMinor: a.balanceMinor + gapOf.get(a.account.id)! } : a)),
    cashMinor: state.cashMinor + total,
    assets: { ...state.assets, cashMinor: state.assets.cashMinor + total, totalMinor: state.assets.totalMinor + total },
    netWorthMinor: state.netWorthMinor + total,
  };
}

/** A balance history on the same footing: from each statement's day on, its gap is part of what you had. */
export function applyAnchorGapsToSeries(points: BalancePoint[], gaps: AnchorGap[]): BalancePoint[] {
  if (gaps.length === 0) return points;
  return points.map((p) => {
    const add = gaps.reduce((t, g) => (g.date <= p.date ? t + g.gapMinor : t), 0);
    return add === 0 ? p : { ...p, netWorthMinor: p.netWorthMinor + add, assetsMinor: p.assetsMinor + add };
  });
}
