/**
 * The last four digits of the card a credit card statement is for. Statements print the card number
 * masked ("4893 77XX XXXX 1234", "XXXX XXXX XXXX 1234", "5241********1234", Amex "3782 XXXXXX X1234"),
 * so only a card-shaped number with some digits hidden and four visible at the end counts: other
 * numbers on the page (customer ids, reference numbers) aren't masked that way.
 */
export function readCardNumber(text: string): string | undefined {
  const CARD = /(?<![\dX*])(?:[\dX*]{4}[ -]?){2,3}[\dX*]{0,4}[ -]?[\dX*]{0,3}(\d{4})(?![\dX*])/gi;
  for (const m of text.matchAll(CARD)) {
    const chars = m[0].replace(/[ -]/g, "");
    if (chars.length < 15 || chars.length > 16 || !/[X*]/i.test(chars)) continue;
    return m[1];
  }
  return undefined;
}
