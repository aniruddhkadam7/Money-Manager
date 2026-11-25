import { brandFor } from "./brands";
import { sameishName } from "./book-ops";
import { involvesPerson } from "./person-summary";
import type { Book, FinancialEvent } from "./types";
import { counterpartyKeyOf, looksLikePerson, normalizeDescription } from "@/lib/statements/normalize";
import { merchantCategory } from "@/lib/statements/rules";

/** Someone the entries name who isn't in People yet. */
export interface FoundPerson {
  /** Stable key (lowercase name words), used to group and to remember "not a person". */
  key: string;
  name: string;
  entries: number;
  paidMinor: number;
  receivedMinor: number;
  lastDate: string;
}

/** Manual entries: "Paid Rahul", "Sent to Priya Shah", "Received from Amit for rent". */
const MANUAL =
  /^(?:(?:paid|sent|gave|given|returned|transferred)\s+(?:to\s+)?|(?:received|got)\s+from\s+|(?:to|from)\s+)([a-z][a-z.' ]{1,40}?)(?:\s+(?:for|on|via|through)\b.*|\s*-.*)?$/i;

/** The person an entry names, if it names one: from the bank line when it came from a statement, else the description. */
function namedPerson(e: FinancialEvent): string | null {
  if (e.type !== "expense" && e.type !== "income" && e.type !== "transfer") return null;
  const narration = e.sources?.find((s) => s.narration)?.narration;
  if (narration) {
    const n = normalizeDescription(narration);
    // As the statement import decides it: a UPI / handle payment to what reads as a person's full name (or a phone-number handle).
    const handle = !!n.vpa || n.mode === "UPI" || n.mode === "IMPS";
    if (!handle || !looksLikePerson(n.counterpartyKey, n.vpa)) return null;
    if (!n.counterpartyKey.includes(" ") && !/^\d{10}@/.test(n.vpa ?? "")) return null;
    if (brandFor(n.counterparty) || merchantCategory(narration.toLowerCase())) return null;
    return n.counterparty;
  }
  const d = e.description?.trim();
  if (!d) return null;
  const m = MANUAL.exec(d);
  // Only when the description says who it went to or came from ("to Rahul"), never a bare "Groceries".
  if (!m) return null;
  const name = m[1].trim();
  const key = counterpartyKeyOf(name);
  if (!looksLikePerson(key, null) || brandFor(name) || merchantCategory(name.toLowerCase())) return null;
  return name.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * People the entries name (UPI payments, "paid to Rahul") who aren't in People yet: so everyone money went to
 * or came from shows up, not only those you lent to or borrowed from. Most entries first.
 */
export function findPeopleInEntries(book: Book, hidden: ReadonlySet<string> = new Set()): FoundPerson[] {
  const found: FoundPerson[] = [];
  for (const e of book.events) {
    if (e.type !== "expense" && e.type !== "income" && e.type !== "transfer") continue;
    const name = namedPerson(e);
    if (!name) continue;
    const key = counterpartyKeyOf(name);
    if (!key || hidden.has(key)) continue;
    // Already someone in People (by any of their names, or the same name cut short).
    if (book.people.some((p) => involvesPerson(e, p) || [p.name, ...(p.aliases ?? [])].some((n) => sameishName(n, name)))) continue;

    let f = found.find((x) => x.key === key || sameishName(x.name, name));
    if (!f) {
      f = { key, name, entries: 0, paidMinor: 0, receivedMinor: 0, lastDate: e.date };
      found.push(f);
    }
    if (name.length > f.name.length) f.name = name;
    f.entries += 1;
    if (e.type === "income") f.receivedMinor += e.amountMinor;
    else f.paidMinor += e.amountMinor;
    if (e.date > f.lastDate) f.lastDate = e.date;
  }
  return found.sort((a, b) => b.entries - a.entries || b.paidMinor + b.receivedMinor - (a.paidMinor + a.receivedMinor) || a.name.localeCompare(b.name));
}
