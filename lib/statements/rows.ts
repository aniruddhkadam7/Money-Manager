import { baseFingerprint, occurrenceIndexes } from "./fingerprint";
import { normalizeDescription } from "./normalize";
import type { ParsedStatement, StatementRow } from "./types";

/**
 * Parsed lines -> statement rows. The raw description is carried through untouched;
 * everything derived from it (normalized text, counterparty, fingerprint) sits beside it.
 */
export function buildRows(parsed: ParsedStatement, p: { importId: string; accountId: string; newId: () => string }): StatementRow[] {
  const rows = parsed.rows.map((r): StatementRow => {
    const normalized = normalizeDescription(r.rawDescription);
    const direction = r.creditMinor > 0 && r.debitMinor === 0 ? "credit" : "debit";
    const amountMinor = direction === "credit" ? r.creditMinor : r.debitMinor;
    const reference = r.reference ?? normalized.reference ?? undefined;
    return {
      id: p.newId(),
      importId: p.importId,
      index: r.index,
      sourcePage: r.page,
      sourceY: r.y,
      transactionDate: r.date,
      valueDate: r.valueDate,
      rawDescription: r.rawDescription,
      normalizedDescription: normalized.text,
      debitMinor: r.debitMinor,
      creditMinor: r.creditMinor,
      amountMinor,
      direction,
      balanceAfterMinor: r.balanceMinor,
      referenceNumber: reference,
      accountId: p.accountId,
      extractionConfidence: r.confidence,
      rawData: { line: r.rawLine, warnings: r.warnings },
      normalized,
      fingerprint: baseFingerprint({
        accountId: p.accountId,
        date: r.date,
        direction,
        amountMinor,
        reference,
        counterpartyKey: normalized.counterpartyKey,
      }),
      occurrence: 0,
      status: "pending",
    };
  });
  const occ = occurrenceIndexes(rows.map((r) => r.fingerprint));
  rows.forEach((r, i) => (r.occurrence = occ[i]));
  return rows;
}
