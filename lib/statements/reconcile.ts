import { formatRupees } from "@/lib/finance/describe";
import { parseStatementDate } from "./parse-values";
import type { ParsedStatement, ReconIssue, Reconciliation } from "./types";

/**
 * Does the statement add up?  opening + credits − debits = closing, and every line's running
 * balance follows from the line before it. If not, a line was missed or misread, and importing
 * would put wrong numbers in the ledger.
 */
export function reconcile(parsed: ParsedStatement): Reconciliation {
  const rows = parsed.rows;
  const issues: ReconIssue[] = [];
  const totalDebitsMinor = rows.reduce((t, r) => t + r.debitMinor, 0);
  const totalCreditsMinor = rows.reduce((t, r) => t + r.creditMinor, 0);

  // 1. Each line must be well-formed.
  rows.forEach((r, i) => {
    if (!parseStatementDate(r.date)) issues.push({ kind: "invalid_date", rowIndex: i, message: `Line ${i + 1} has an unreadable date.` });
    if (!Number.isSafeInteger(r.debitMinor) || !Number.isSafeInteger(r.creditMinor) || (r.debitMinor === 0 && r.creditMinor === 0)) {
      issues.push({ kind: "invalid_amount", rowIndex: i, message: `Line ${i + 1} has no readable amount.` });
    } else if (r.debitMinor > 0 && r.creditMinor > 0) {
      issues.push({ kind: "invalid_amount", rowIndex: i, message: `Line ${i + 1} shows both a debit and a credit.` });
    }
    if (r.confidence < 0.6) issues.push({ kind: "low_confidence", rowIndex: i, message: `Line ${i + 1} was hard to read: ${r.warnings[0] ?? "low confidence"}.` });
    if (parsed.periodStart && parsed.periodEnd && (r.date < parsed.periodStart || r.date > parsed.periodEnd)) {
      issues.push({ kind: "date_out_of_period", rowIndex: i, message: `Line ${i + 1} is dated outside the statement period.` });
    }
  });

  // 2. The running balance must follow from line to line. Some banks print an overdrawn balance without
  // its minus sign, so a balance that matches in size but not in sign still counts as consistent.
  let pairsChecked = 0;
  let signless = 0;
  let running: number | undefined = parsed.openingDerived ? undefined : parsed.openingBalanceMinor;
  for (let i = 0; i < rows.length; i++) {
    const after = rows[i].balanceMinor;
    if (running === undefined) {
      running = after;
      continue;
    }
    const expectedAfter = running + rows[i].creditMinor - rows[i].debitMinor;
    if (after === undefined) {
      running = expectedAfter;
      continue;
    }
    pairsChecked++;
    if (expectedAfter === after) running = after;
    else if (Math.abs(expectedAfter) === after) {
      signless++;
      running = expectedAfter;
    } else {
      issues.push({
        kind: "balance_jump",
        rowIndex: i,
        message:
          `After line ${i + 1} the balance should be ${formatRupees(expectedAfter)} but the statement says ${formatRupees(after)} ` +
          `(${formatRupees(Math.abs(after - expectedAfter))} ${after > expectedAfter ? "more" : "less"}). A transaction may be missing or misread near here.`,
      });
      running = after;
    }
  }
  void signless;

  // 3. The statement's own totals.
  const opening = parsed.openingBalanceMinor;
  const statedClosing = parsed.closingBalanceMinor;
  const lastBalance = rows.length ? rows[rows.length - 1].balanceMinor : undefined;
  const actualClosing = statedClosing ?? lastBalance;
  let expectedClosing: number | undefined;
  let difference: number | undefined;
  let totalsChecked = false;
  if (opening !== undefined && actualClosing !== undefined && !(parsed.openingDerived && statedClosing === undefined)) {
    expectedClosing = opening + totalCreditsMinor - totalDebitsMinor;
    difference = actualClosing - expectedClosing;
    // With a derived opening and a printed closing, the comparison is still meaningful (it checks the last balance chain).
    totalsChecked = true;
    if (difference !== 0) {
      issues.push({
        kind: "balance_mismatch",
        message:
          `Opening ${formatRupees(opening)} + credits ${formatRupees(totalCreditsMinor)} − debits ${formatRupees(totalDebitsMinor)} = ${formatRupees(expectedClosing)}, ` +
          `but the statement's closing balance is ${formatRupees(actualClosing)} (${formatRupees(Math.abs(difference))} ${difference > 0 ? "higher" : "lower"}).`,
      });
    }
  }

  const verifiable = pairsChecked > 0 || totalsChecked;
  if (!verifiable) {
    issues.push({
      kind: "no_totals",
      message: "This statement has no balances we could read, so we can't prove every transaction was captured. Compare the totals yourself before importing.",
    });
  }

  const BLOCKING: ReconIssue["kind"][] = ["balance_mismatch", "balance_jump", "invalid_date", "invalid_amount"];
  const ok = verifiable && !issues.some((i) => BLOCKING.includes(i.kind));
  return {
    ok,
    verifiable,
    openingMinor: opening,
    totalDebitsMinor,
    totalCreditsMinor,
    expectedClosingMinor: expectedClosing,
    actualClosingMinor: actualClosing,
    differenceMinor: difference,
    issues,
  };
}
