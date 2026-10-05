import type { Normalized } from "./types";

/**
 * Bank narrations are noisy: "UPI/403821907312/SWIGGY/swiggyupi@icici", "UPI-SWIGGY-12345",
 * "SWIGGY INDIA PVT LTD" all mean the same merchant. This extracts a readable counterparty
 * and a stable matching key. It never replaces the raw description.
 */

const MODES = new Set([
  "UPI", "NEFT", "IMPS", "RTGS", "ACH", "NACH", "ECS", "ATM", "POS", "ECOM", "CHQ", "CHEQUE", "INT", "BIL", "BILLPAY",
  "MB", "IB", "DC", "NFS", "CASH", "FT", "TPT", "SI", "CLG", "MMT", "INF", "NWD", "AWB",
]);

/** Words that describe the payment, not who was paid. */
const NOISE_WORDS = new Set([
  "CR", "DR", "P2A", "P2M", "P2P", "PAYMENT", "PAYMENTS", "PAY", "TRANSFER", "TRF", "TO", "FROM", "BY", "TXN", "REF", "NO",
  "SENT", "USING", "VIA", "COLLECT", "REQUEST", "THROUGH", "ONLINE", "TRANSACTION", "UPIINTENT", "NA", "NIL", "OK",
  "WITHDRAWAL", "WDL", "DEP", "DEPOSIT", "CREDIT", "DEBIT", "MOBILE", "BANKING", "NETBANKING", "PURCHASE", "SALE",
]);

const BANK_CODES = new Set([
  "HDFC", "ICIC", "ICICI", "SBIN", "SBI", "UTIB", "AXIS", "KKBK", "KOTAK", "YESB", "PUNB", "BARB", "CNRB", "IDIB", "IOBA",
  "UBIN", "FDRL", "INDB", "RATN", "PYTM", "YBL", "OKHDFCBANK", "OKSBI", "OKAXIS", "OKICICI", "IDFB", "SIBL", "KARB",
]);

const COMPANY_SUFFIXES = new Set(["pvt", "ltd", "limited", "private", "india", "inc", "llp", "co", "corp", "company", "pte", "opc"]);

// A UPI ID. The local part excludes hyphens because hyphens usually separate fields (UPI-SWIGGY-swiggy@icici).
const VPA = /[\w.+]+@[a-zA-Z][\w.]*/;
const LONG_DIGITS = /^\d{9,}$/;
const ALNUM_REF = /^[A-Z]{0,6}\d{8,}[A-Z0-9]*$/i;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const MASKED = /[X*]{3,}/i;

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s.&'-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());

function isNoiseToken(token: string): boolean {
  const t = token.toUpperCase();
  return (
    MODES.has(t) ||
    NOISE_WORDS.has(t) ||
    BANK_CODES.has(t) ||
    LONG_DIGITS.test(t) ||
    ALNUM_REF.test(t) ||
    IFSC.test(t) ||
    MASKED.test(t) ||
    /^\d+$/.test(t) ||
    /^[\d.,]+$/.test(t)
  );
}

export function detectMode(description: string): string | null {
  const first = description.trim().split(/[\s/\-|]+/)[0]?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
  if (MODES.has(first)) return first === "CHEQUE" ? "CHQ" : first;
  const m = /\b(UPI|NEFT|IMPS|RTGS|ATM|POS|ACH|NACH)\b/i.exec(description);
  return m ? m[1].toUpperCase() : null;
}

/** The comparison key for a counterparty: lowercase words without company suffixes. */
export function counterpartyKeyOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !COMPANY_SUFFIXES.has(w) && !/^\d+$/.test(w))
    .join(" ")
    .trim();
}

export function normalizeDescription(raw: string): Normalized {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const mode = detectMode(cleaned);

  const vpaMatch = VPA.exec(cleaned);
  const vpa = vpaMatch ? vpaMatch[0].toLowerCase() : null;
  const withoutVpa = vpaMatch ? cleaned.replace(vpaMatch[0], " ") : cleaned;

  // Reference: the first long number / UTR-like token.
  let reference: string | null = null;
  for (const token of withoutVpa.split(/[\s/\-|]+/)) {
    if (LONG_DIGITS.test(token) || (ALNUM_REF.test(token) && /\d{8,}/.test(token))) {
      reference = token;
      break;
    }
  }

  // Segments separated by / | or hyphen-between-words; keep spaces inside a segment so names stay whole.
  const segments = withoutVpa
    .split(/[/|]|\s-\s|-(?=[A-Za-z0-9\s])|-$/)
    .map((seg) =>
      seg
        .split(/\s+/)
        .filter((w) => w && !isNoiseToken(w))
        .join(" ")
        .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.)]+$/g, "")
        .trim(),
    )
    .filter((seg) => /[A-Za-z]{2,}/.test(seg));

  const counterpartyRaw = segments[0] ?? "";
  const counterparty = counterpartyRaw && counterpartyRaw === counterpartyRaw.toUpperCase() ? titleCase(counterpartyRaw) : counterpartyRaw;
  const counterpartyKey = counterpartyKeyOf(counterpartyRaw);

  // Fallback text when nothing meaningful remains (e.g. "ATM WDL"): the raw text without numbers.
  const fallback = cleaned.replace(/[\d/|-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

  return {
    mode,
    reference,
    vpa,
    counterparty,
    counterpartyKey,
    text: counterpartyKey || fallback,
  };
}

/** Does this look like an individual's name rather than a business? (Used to decide person vs merchant.) */
export function looksLikePerson(counterpartyKey: string, vpa: string | null): boolean {
  if (!counterpartyKey) return false;
  const words = counterpartyKey.split(" ");
  if (words.length < 1 || words.length > 3) return false;
  if (!words.every((w) => /^[a-z]{2,}$/.test(w))) return false;
  const BUSINESS = /(stores?|mart|traders?|enterprises?|services?|solutions?|tech|technologies|systems|bank|payments?|foods?|restaurant|cafe|hotel|pharma|pharmacy|medical|hospital|clinic|mobile|energy|power|electric|insurance|finance|capital|fund|motors?|travels?|airlines?|airways?|rail|metro|cabs?|taxi|retail|supermarket|bazaar|market|shop|labs?|academy|school|college|university|digital|online|app|media|studios?|cinemas?|pvt|ltd)$/;
  if (words.some((w) => BUSINESS.test(w))) return false;
  // VPAs of businesses often contain numbers or brand words; personal ones usually look like names or phone numbers.
  if (vpa && /\b(pay|merchant|shop|store|bill|paytm\.|upi)\b/.test(vpa.split("@")[0])) return false;
  return true;
}
