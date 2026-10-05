import { sha256Text } from "./sha256";
import type { Direction } from "./types";

export { sha256Bytes as fileHash } from "./sha256";

/**
 * A transaction's identity, independent of which statement printed it: same account, day,
 * direction and amount, plus the bank reference when there is one (else who it was with).
 * Two statements that overlap print the same line, so they produce the same fingerprint.
 */
export function baseFingerprint(p: {
  accountId: string;
  date: string;
  direction: Direction;
  amountMinor: number;
  reference?: string | null;
  counterpartyKey: string;
}): string {
  const anchor = p.reference ? `ref:${p.reference.toLowerCase()}` : `cp:${p.counterpartyKey}`;
  return sha256Text([p.accountId, p.date, p.direction, p.amountMinor, anchor].join("|"));
}

/** Assigns 0,1,2... to lines sharing a fingerprint, in statement order. */
export function occurrenceIndexes(fingerprints: string[]): number[] {
  const seen = new Map<string, number>();
  return fingerprints.map((f) => {
    const n = seen.get(f) ?? 0;
    seen.set(f, n + 1);
    return n;
  });
}
