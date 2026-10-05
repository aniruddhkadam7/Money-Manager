import type { Book, FinancialEvent, Ledger } from "@/lib/finance/types";
import { daysBetween } from "./dedupe";
import type { RowMatch, StatementRow } from "./types";

/** Signed change each event made to each account's balance (+ money in, − money out). */
export function cashEffects(ledger: Ledger): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const entry of ledger.entries) {
    for (const p of entry.postings) {
      if (!p.ledger.startsWith("acct:")) continue;
      const acct = p.ledger.slice(5);
      let byAcct = out.get(entry.sourceId);
      if (!byAcct) out.set(entry.sourceId, (byAcct = new Map()));
      byAcct.set(acct, (byAcct.get(acct) ?? 0) + p.amountMinor);
    }
  }
  return out;
}

const STOP = new Set(["upi", "neft", "imps", "rtgs", "the", "and", "for", "from", "payment", "paid", "pay", "ref", "txn", "bank", "ltd", "pvt", "india", "ach", "pos", "debit", "credit"]);
const tokens = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t)),
  );

/** How much of the smaller word set is found in the other (0..1). */
export function textSimilarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let hit = 0;
  for (const t of A) {
    if (B.has(t) || [...B].some((u) => u.length >= 4 && t.length >= 4 && (u.startsWith(t) || t.startsWith(u)))) hit++;
  }
  return hit / Math.min(A.size, B.size);
}

/** Everything the user wrote or chose about an entry that a bank narration might echo. */
export function eventText(book: Book, e: FinancialEvent, categoryName: (id: string) => string): string {
  const parts: string[] = [e.description ?? "", e.note ?? ""];
  const person = (id: string) => book.people.find((p) => p.id === id)?.name ?? "";
  const account = (id: string) => book.accounts.find((a) => a.id === id)?.name ?? "";
  if ("categoryId" in e) parts.push(categoryName(e.categoryId));
  if ("personId" in e) parts.push(person(e.personId));
  if (e.type === "split_expense") e.shares.forEach((s) => parts.push(person(s.personId)));
  if (e.type === "transfer") parts.push(account(e.fromAccountId), account(e.toAccountId));
  if (e.type === "invest") parts.push(account(e.holdingId));
  if (e.type === "sell_investment" || e.type === "update_valuation") parts.push(account(e.holdingId));
  return parts.join(" ");
}

const isGeneric = (e: FinancialEvent) => !e.description || e.description.trim().length < 3;

interface Candidate {
  row: StatementRow;
  event: FinancialEvent;
  imported: boolean;
  level: 1 | 2 | 3;
  score: number;
  reason: string;
}

export const MATCH_WINDOW_DAYS = 3;

/**
 * Matches statement lines to entries the person already made. Compares the real effect on the
 * statement's account, not the entry's type, so a "transfer to UPI" and a plain credit still match.
 * One line matches at most one entry, and entries already confirmed by a statement are left alone.
 */
export function matchExistingEntries(rows: StatementRow[], book: Book, ledger: Ledger, categoryName: (id: string) => string): void {
  const effects = cashEffects(ledger);
  const applied = new Set(ledger.entries.map((e) => e.sourceId));
  const candidates: Candidate[] = [];

  for (const row of rows) {
    if (row.match) continue;
    const signed = row.direction === "credit" ? row.amountMinor : -row.amountMinor;
    for (const e of book.events) {
      if (!applied.has(e.id)) continue;
      const fromStatement = e.sources?.filter((x) => x.kind === "statement") ?? [];
      if (effects.get(e.id)?.get(row.accountId) !== signed) continue;
      const diff = daysBetween(e.date, row.transactionDate);
      if (diff > MATCH_WINDOW_DAYS) continue;

      // An entry an earlier import created is the same line again if it falls on the same day and says the same thing.
      const sameLine = fromStatement.some((x) => (x.fingerprint && x.fingerprint === row.fingerprint) || (x.narration && x.narration.replace(/\s+/g, " ").trim() === row.rawDescription.replace(/\s+/g, " ").trim()));
      if (fromStatement.length > 0 && diff !== 0) continue;

      const sim = textSimilarity(`${row.normalized.counterparty} ${row.normalizedDescription}`, eventText(book, e, categoryName));
      let level: 1 | 2 | 3;
      if (sameLine) level = 1;
      else if (fromStatement.length > 0 && sim < 0.25) continue; // an imported entry must clearly be this line
      else if (diff <= 1 && sim >= 0.5) level = 1;
      else if (sim >= 0.25) level = 2;
      else if (diff === 0 && isGeneric(e)) level = 2;
      else level = 3;
      const when = diff ? `${diff} day(s) apart` : "on the same day";
      candidates.push({
        row,
        event: e,
        imported: fromStatement.length > 0,
        level,
        score: 0.5 + 0.3 * sim + 0.2 * (1 - diff / (MATCH_WINDOW_DAYS + 1)),
        reason:
          level === 3
            ? `An entry with the same amount exists (${when}), but its wording doesn't clearly match.`
            : `Same amount, ${when}${sim >= 0.25 ? ", and the wording matches" : ""}.`,
      });
    }
  }

  candidates.sort((a, b) => a.level - b.level || b.score - a.score || a.row.index - b.row.index);
  const usedRows = new Set<string>();
  const usedEvents = new Set<string>();
  for (const c of candidates) {
    if (usedRows.has(c.row.id) || usedEvents.has(c.event.id)) continue;
    usedRows.add(c.row.id);
    usedEvents.add(c.event.id);
    if (c.imported) {
      c.row.match = { kind: "previous_import", level: 1, eventId: c.event.id, score: c.score, reason: "This line was already imported from another upload of the statement." };
      c.row.status = "already_imported";
      c.row.eventId = c.event.id;
      continue;
    }
    const match: RowMatch = {
      kind: c.level === 3 ? "possible_existing" : "existing_event",
      level: c.level,
      eventId: c.event.id,
      score: c.score,
      reason: c.reason,
    };
    c.row.match = match;
    if (c.level === 3) c.row.status = "possible_duplicate";
    else {
      c.row.status = "matched_existing";
      c.row.eventId = c.event.id;
    }
  }
}

/**
 * Lines already imported from another statement (overlapping periods). Uses the fingerprint one-for-one,
 * so ten identical ₹50 lines are matched against ten earlier lines, not all against the first.
 */
export function matchPreviousImports(rows: StatementRow[], previous: StatementRow[]): void {
  const pool = new Map<string, StatementRow[]>();
  for (const p of previous) {
    if (p.status !== "imported" && p.status !== "matched_existing" && p.status !== "already_imported") continue;
    const list = pool.get(p.fingerprint);
    if (list) list.push(p);
    else pool.set(p.fingerprint, [p]);
  }
  for (const row of rows) {
    if (row.match) continue;
    const hit = pool.get(row.fingerprint)?.shift();
    if (!hit) continue;
    row.match = {
      kind: "previous_import",
      level: 1,
      eventId: hit.eventId,
      score: 1,
      reason: "This line was already imported from another statement.",
    };
    row.status = "already_imported";
    row.eventId = hit.eventId;
  }
}
