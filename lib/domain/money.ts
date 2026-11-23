const MAX_MINOR = 100_000_000_000; // ₹1,000 crore: a sanity ceiling, not a business rule

/**
 * Parses user input like "850", "1,250.50" or "₹ 99.9" into paise. Returns null if invalid.
 * Zero is invalid unless `allowZero` (an investment can be worth nothing).
 */
export function parseAmountToMinor(input: string, allowZero = false): number | null {
  const cleaned = input.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const minor = Math.round(parseFloat(cleaned) * 100);
  return (minor > 0 || (allowZero && minor === 0)) && minor <= MAX_MINOR ? minor : null;
}

/** An amount as it shows in a field, with Indian commas: 100000 → "1,00,000", 125050 → "1,250.50". */
export function minorToInputString(amountMinor: number): string {
  return groupAmountInput(
    amountMinor % 100 === 0 ? String(amountMinor / 100) : (amountMinor / 100).toFixed(2),
  );
}

/** "1234567" → "12,34,567": groups of two, then the last three, as amounts are written in India. */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  return `${head.replace(/\B(?=(\d{2})+$)/g, ",")},${digits.slice(-3)}`;
}

/**
 * What's typed into an amount field, tidied as you type: Indian commas, one decimal point, at most two
 * decimals, no leading zeros. Anything else typed is dropped. "100000" → "1,00,000", "1250.5" → "1,250.5".
 */
export function groupAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (cleaned === "") return "";
  const dot = cleaned.indexOf(".");
  let whole = dot === -1 ? cleaned : cleaned.slice(0, dot);
  const frac = dot === -1 ? null : cleaned.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  whole = whole.replace(/^0+(?=\d)/, "");
  if (whole === "" && frac !== null) whole = "0";
  return groupIndian(whole) + (frac === null ? "" : `.${frac}`);
}

/**
 * Reformats an amount field in place as it's typed, keeping the caret beside the same digit (commas come and go
 * around it). Call it first thing in the field's onChange; `e.target.value` is the tidied text afterwards.
 */
export function formatAmountField(input: HTMLInputElement): void {
  const raw = input.value;
  const next = groupAmountInput(raw);
  if (next === raw) return;
  const caret = input.selectionStart ?? raw.length;
  // Count the digits and point before the caret, then put the caret after as many in the new text.
  let keep = raw.slice(0, caret).replace(/[^\d.]/g, "").length;
  let pos = 0;
  while (pos < next.length && keep > 0) {
    if (next[pos] !== ",") keep--;
    pos++;
  }
  input.value = next;
  try {
    input.setSelectionRange(pos, pos);
  } catch {
    // Some input types don't have a caret.
  }
}
