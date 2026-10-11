const MAX_MINOR = 100_000_000_000; // ₹1,000 crore: a sanity ceiling, not a business rule

/** Parses user input like "850", "1,250.50" or "₹ 99.9" into paise. Returns null if invalid. */
export function parseAmountToMinor(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const minor = Math.round(parseFloat(cleaned) * 100);
  return minor > 0 && minor <= MAX_MINOR ? minor : null;
}

export function minorToInputString(amountMinor: number): string {
  return amountMinor % 100 === 0
    ? String(amountMinor / 100)
    : (amountMinor / 100).toFixed(2);
}
