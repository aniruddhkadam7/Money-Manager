import type { ParsedStatement, StatementRow } from "./types";

const dayNumber = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;
export const daysBetween = (a: string, b: string) => Math.abs(dayNumber(a) - dayNumber(b));

type Opening = Pick<ParsedStatement, "openingBalanceMinor" | "openingDerived">;

/**
 * True when the running balance proves this line really happened: the balance after it equals the
 * balance before it plus the line. Two similar lines that both pass are two real transactions.
 */
function provenByBalance(rows: StatementRow[], i: number, parsed: Opening): boolean {
  const after = rows[i].balanceAfterMinor;
  if (after === undefined) return false;
  const before = i === 0 ? (parsed.openingDerived ? undefined : parsed.openingBalanceMinor) : rows[i - 1].balanceAfterMinor;
  if (before === undefined) return false;
  const expected = before + rows[i].creditMinor - rows[i].debitMinor;
  return expected === after || Math.abs(expected) === after; // some banks omit the minus on an overdrawn balance
}

/**
 * Duplicates inside one statement.
 *  - Identical line AND identical balance: it was read twice (a repeated page, overlapping text). Dropped.
 *  - Similar lines (same direction, amount, counterparty, within 3 days): sent to review as a *possible*
 *    duplicate, unless the bank's own balances prove both are real, or they carry different references.
 * Nothing else is ever dropped on a hunch.
 */
export function detectDuplicatesWithinStatement(rows: StatementRow[], parsed: Opening): void {
  for (let j = 1; j < rows.length; j++) {
    const b = rows[j];
    if (b.match) continue;
    for (let i = j - 1; i >= 0; i--) {
      const a = rows[i];
      const gap = daysBetween(a.transactionDate, b.transactionDate);
      if (gap > 3) {
        if (a.transactionDate < b.transactionDate) break; // chronological: nothing earlier is closer
        continue;
      }
      if (a.direction !== b.direction || a.amountMinor !== b.amountMinor || a.status === "skipped") continue;

      const sameFingerprint = a.fingerprint === b.fingerprint;
      if (sameFingerprint && gap === 0 && a.balanceAfterMinor !== undefined && a.balanceAfterMinor === b.balanceAfterMinor) {
        b.match = {
          kind: "in_statement_duplicate",
          level: 1,
          otherRowId: a.id,
          score: 1,
          reason: "The same line appears twice in this statement with the same balance, so it was probably read twice.",
        };
        b.status = "skipped";
        b.decision = { by: "auto", at: "", note: "Duplicate of an identical line in the same statement" };
        break;
      }

      if (a.normalized.counterpartyKey !== b.normalized.counterpartyKey) continue;
      const refA = a.referenceNumber?.toLowerCase();
      const refB = b.referenceNumber?.toLowerCase();
      if (refA && refB && refA !== refB) continue; // two different bank references: two different payments
      if (provenByBalance(rows, i, parsed) && provenByBalance(rows, j, parsed)) continue; // the balances show both happened

      const why = refA && refB ? "They share the same bank reference." : "At least one has no bank reference to tell them apart.";
      b.match = {
        kind: "possible_in_statement",
        level: 3,
        otherRowId: a.id,
        score: sameFingerprint ? 0.8 : 0.65,
        reason: `Same amount, direction and counterparty ${gap === 0 ? "on the same day" : `${gap} day(s) apart`}. ${why}`,
      };
      b.status = "possible_duplicate";
      break;
    }
  }
}
