/**
 * Indian banks and card issuers, recognised from an account's name or the bank a statement names.
 * Logos are static files in /public/brands, so showing them never makes a network request: the official
 * vector logo (from Wikimedia Commons / Wikipedia) where there is one, else the bank site's own icon
 * (fetched once with scripts/fetch-brand-logos.mjs, which reads this list too).
 */
export interface BankBrand {
  slug: string;
  name: string;
  /** Official site the logo is fetched from. */
  domain: string;
  re: RegExp;
}

/** Banks whose official vector logo is in /public/brands as `<slug>.svg`; the rest use `<slug>.png`. */
const VECTOR = new Set(["bank-amex", "bank-axis", "bank-bandhan", "bank-bob", "bank-federal", "bank-hdfc", "bank-kotak", "bank-paytm", "bank-pnb", "bank-sbi", "bank-union", "bank-yes"]);

export const bankLogoSrc = (b: BankBrand): string => `/brands/${b.slug}.${VECTOR.has(b.slug) ? "svg" : "png"}`;

const k = (slug: string, name: string, domain: string, re: RegExp): BankBrand => ({ slug, name, domain, re });

/** More specific names first: "SBI Card" before "SBI", "IDFC First" before anything else with "first". */
export const BANK_BRANDS: BankBrand[] = [
  k("bank-sbicard", "SBI Card", "sbicard.com", /sbi ?card/),
  k("bank-onecard", "OneCard", "getonecard.app", /one ?card/),
  k("bank-kotak", "Kotak Mahindra Bank", "kotak.com", /kotak|kkbk/),
  k("bank-hdfc", "HDFC Bank", "hdfcbank.com", /hdfc/),
  k("bank-icici", "ICICI Bank", "icicibank.com", /icici/),
  k("bank-sbi", "State Bank of India", "onlinesbi.sbi", /state bank of india|\bsbi\b/),
  k("bank-axis", "Axis Bank", "axisbank.com", /axis/),
  k("bank-yes", "YES Bank", "yesbank.in", /yes ?bank/),
  k("bank-idfc", "IDFC FIRST Bank", "idfcfirstbank.com", /idfc/),
  k("bank-indusind", "IndusInd Bank", "indusind.com", /indusind/),
  k("bank-pnb", "Punjab National Bank", "pnbindia.in", /punjab national|\bpnb\b/),
  k("bank-bob", "Bank of Baroda", "bankofbaroda.in", /bank of baroda|\bbob\b/),
  k("bank-canara", "Canara Bank", "canarabank.com", /canara/),
  k("bank-union", "Union Bank of India", "unionbankofindia.co.in", /union bank/),
  k("bank-federal", "Federal Bank", "federalbank.co.in", /federal bank/),
  k("bank-au", "AU Small Finance Bank", "aubank.in", /\bau (small|bank)/),
  k("bank-bandhan", "Bandhan Bank", "bandhanbank.com", /bandhan/),
  k("bank-idbi", "IDBI Bank", "idbibank.in", /idbi/),
  k("bank-rbl", "RBL Bank", "rblbank.com", /\brbl\b/),
  k("bank-paytm", "Paytm Payments Bank", "paytmbank.com", /paytm/),
  k("bank-amex", "American Express", "americanexpress.com", /american express|\bamex\b/),
];

/** The bank or issuer named in any of these texts (account name first, then a statement's bank). */
export function bankBrandFor(...texts: (string | undefined)[]): BankBrand | null {
  for (const text of texts) {
    if (!text) continue;
    const t = text.toLowerCase();
    const hit = BANK_BRANDS.find((b) => b.re.test(t));
    if (hit) return hit;
  }
  return null;
}
