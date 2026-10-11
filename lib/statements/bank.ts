import { startsWithDate } from "./parse-values";

/**
 * Which bank issued a statement. Payment lines name other people's banks all the time ("UPI/FLIPKART
 * PAYME/HDFC/…", "zomato@hdfcbank", "NEFT CR-HDFC0000001"), so only the statement's own furniture counts:
 *
 * 1. Its own IFSC code, printed next to the word "IFSC": that settles it.
 * 2. Otherwise the bank's full name or website, in lines that aren't payments. The header (above the
 *    first transaction) counts most; footers and fine print ("… Kotak Mahindra Bank Ltd.") count too.
 *
 * A bare code like "HDFC" or "ICICI" is never enough, and when two banks are equally likely the answer
 * is "don't know": an unnamed bank makes the app ask, a wrong one files money in the wrong account.
 */

interface Bank {
  name: string;
  /** First four letters of the bank's IFSC codes. */
  ifsc: string;
  re: RegExp;
}

const BANKS: Bank[] = [
  { name: "HDFC Bank", ifsc: "HDFC", re: /\bhdfc bank\b|hdfcbank\.(com|net)/ },
  { name: "ICICI Bank", ifsc: "ICIC", re: /\bicici bank\b|icicibank\.com/ },
  { name: "State Bank of India", ifsc: "SBIN", re: /state bank of india|onlinesbi|\bsbi\.co\.in/ },
  { name: "Axis Bank", ifsc: "UTIB", re: /\baxis bank\b|axisbank\.com/ },
  { name: "Kotak Mahindra Bank", ifsc: "KKBK", re: /kotak mahindra|kotak\.(com|bank)\b/ },
  { name: "YES Bank", ifsc: "YESB", re: /\byes bank\b|yesbank\.in/ },
  { name: "IDFC FIRST Bank", ifsc: "IDFB", re: /idfc first|idfcfirstbank/ },
  { name: "Punjab National Bank", ifsc: "PUNB", re: /punjab national bank|pnbindia/ },
  { name: "Bank of Baroda", ifsc: "BARB", re: /bank of baroda|bankofbaroda/ },
  { name: "Canara Bank", ifsc: "CNRB", re: /canara bank|canarabank/ },
  { name: "IndusInd Bank", ifsc: "INDB", re: /indusind bank|indusind\.com/ },
  { name: "Federal Bank", ifsc: "FDRL", re: /\bfederal bank\b|federalbank\.co/ },
  { name: "Paytm Payments Bank", ifsc: "PYTM", re: /paytm payments bank/ },
  { name: "Union Bank of India", ifsc: "UBIN", re: /union bank of india/ },
  { name: "AU Small Finance Bank", ifsc: "AUBL", re: /au small finance bank/ },
  { name: "Bandhan Bank", ifsc: "BDBL", re: /bandhan bank/ },
  { name: "IDBI Bank", ifsc: "IBKL", re: /\bidbi bank\b/ },
  { name: "RBL Bank", ifsc: "RATN", re: /\brbl bank\b/ },
];

/** A payment line, or a piece of one: it names the other side's bank, not this statement's. */
function isPaymentText(text: string): boolean {
  return (
    /@|upi|\b(neft|imps|rtgs|nach|ach|mmt|pos|atm|vpa)\b/i.test(text) ||
    /[/-][A-Za-z]{4}0[A-Za-z0-9]{6}/.test(text) || // an IFSC inside a narration: NEFT CR-HDFC0000001-…
    /\/[A-Za-z]{4}\//.test(text) || // a bank code between slashes: UPI/…/HDFC/…
    /\d{10,}/.test(text) // a transaction reference
  );
}

/** "1 10 Oct 2026 …" (numbered rows) as well as "10 Oct 2026 …". */
const startsTransaction = (text: string) => (startsWithDate(text) || startsWithDate(text.replace(/^\s*\d{1,4}\s+/, ""))) && /\d[\d,]*\.\d{2}/.test(text);

export function readBank(lines: string[]): string | undefined {
  const firstTxn = lines.findIndex(startsTransaction);
  const headerEnd = firstTxn === -1 ? Math.min(lines.length, 25) : firstTxn;

  // 1. The statement's own IFSC.
  const ifscVotes = new Map<string, number>();
  for (const line of lines) {
    if (/@|upi/i.test(line)) continue;
    for (const m of line.matchAll(/\bIFSC\b(?:\s*code)?\s*[:\-]?\s*([A-Za-z]{4})0[A-Za-z0-9]{6}\b/gi)) {
      const bank = BANKS.find((b) => b.ifsc === m[1].toUpperCase());
      if (bank) ifscVotes.set(bank.name, (ifscVotes.get(bank.name) ?? 0) + 1);
    }
  }
  const byIfsc = best(ifscVotes);
  if (byIfsc) return byIfsc;

  // 2. The bank's name or website, outside payment lines.
  const votes = new Map<string, number>();
  lines.forEach((line, i) => {
    if (startsTransaction(line) || isPaymentText(line)) return;
    const t = line.toLowerCase();
    for (const b of BANKS) if (b.re.test(t)) votes.set(b.name, (votes.get(b.name) ?? 0) + (i < headerEnd ? 3 : 1));
  });
  return best(votes);
}

/** The clear winner, or nothing when the top two are tied. */
function best(votes: Map<string, number>): string | undefined {
  const ranked = [...votes].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return undefined;
  if (ranked.length > 1 && ranked[1][1] === ranked[0][1]) return undefined;
  return ranked[0][0];
}
