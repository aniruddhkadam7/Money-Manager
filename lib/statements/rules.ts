import type { Book, Ledger } from "@/lib/finance/types";
import { looksLikePerson } from "./normalize";
import {
  EVENT_DIRECTIONS,
  PERSON_EVENTS,
  type Classification,
  type Direction,
  type StatementEventType,
  type StatementRow,
  type UserRule,
} from "./types";

/* ---------------- Helpers ---------------- */

export const isDirectionCompatible = (type: StatementEventType, direction: Direction) => EVENT_DIRECTIONS[type].includes(direction);

const make = (
  source: Classification["source"],
  eventType: StatementEventType,
  confidence: number,
  reason: string,
  extra: Partial<Classification> = {},
): Classification => ({
  source,
  eventType,
  category: null,
  merchant: null,
  person: null,
  counterAccountId: null,
  holding: null,
  confidence,
  reason,
  alternatives: [],
  ...extra,
});

/* ---------------- What the book already knows about people ---------------- */

export interface Relationship {
  personId: string;
  name: string;
  /** They owe me. */
  owedToMeMinor: number;
  /** I owe them. */
  iOweMinor: number;
}

export function relationships(book: Book, ledger: Ledger): Relationship[] {
  const bal = new Map<string, number>();
  for (const e of ledger.entries) for (const p of e.postings) bal.set(p.ledger, (bal.get(p.ledger) ?? 0) + p.amountMinor);
  return book.people.map((p) => ({
    personId: p.id,
    name: p.name,
    owedToMeMinor: Math.max(0, bal.get(`recv:${p.id}`) ?? 0),
    iOweMinor: Math.max(0, -(bal.get(`pay:${p.id}`) ?? 0)),
  }));
}

/** Finds a known person for a counterparty name: exact (ignoring case), or all words of the known name appear. */
export function findPerson(name: string, people: { name: string }[]): string | null {
  const key = name.toLowerCase().replace(/\s+/g, " ").trim();
  if (!key) return null;
  const exact = people.find((p) => p.name.toLowerCase() === key);
  if (exact) return exact.name;
  const words = new Set(key.split(" "));
  const partial = people.filter((p) => {
    const parts = p.name.toLowerCase().split(/\s+/);
    return parts.length >= 2 && parts.every((w) => words.has(w));
  });
  return partial.length === 1 ? partial[0].name : null;
}

/* ---------------- User-taught rules ---------------- */

/** How much a taught rule is trusted. Person-involving rules need to be confirmed twice to be fully trusted. */
export function userRuleConfidence(rule: Pick<UserRule, "eventType" | "confirmations" | "contradictions" | "always">): number {
  if (rule.always && rule.contradictions === 0) return 0.99;
  const person = PERSON_EVENTS.includes(rule.eventType);
  const base = person ? (rule.confirmations >= 2 ? 0.96 : 0.88) : rule.confirmations >= 3 ? 0.98 : 0.96;
  const penalty = 0.12 * rule.contradictions;
  const conf = base - penalty;
  return Math.max(0.5, Math.round(conf * 100) / 100);
}

export const ruleKey = (row: Pick<StatementRow, "normalized">) => row.normalized.counterpartyKey;

export function applyUserRule(row: StatementRow, rules: UserRule[]): Classification | null {
  const key = ruleKey(row);
  if (!key) return null;
  const rule = rules.find((r) => r.key === key && r.direction === row.direction);
  if (!rule || !isDirectionCompatible(rule.eventType, row.direction)) return null;
  // A rule contradicted as often as it was confirmed is no longer a rule.
  if (rule.contradictions >= rule.confirmations) return null;
  const why = rule.always ? `You said “${row.normalized.counterparty}” is always this.` : `You classified “${row.normalized.counterparty}” this way before (${rule.confirmations}×).`;
  return make("user_rule", rule.eventType, userRuleConfidence(rule), why, {
    category: rule.category,
    person: rule.person,
    counterAccountId: rule.counterAccountId,
    holding: rule.holding,
    merchant: row.normalized.counterparty,
  });
}

/** Records a person's decision as a rule (or strengthens / weakens an existing one). */
export function learnRule(rules: UserRule[], row: StatementRow, c: Classification, now: string, always = false): UserRule[] {
  const key = ruleKey(row);
  if (!key) return rules;
  if (always) {
    // "Always" replaces whatever was known about this name, outright.
    const rule: UserRule = {
      id: `rule-${key}-${row.direction}`,
      key,
      direction: row.direction,
      eventType: c.eventType,
      category: c.category,
      person: c.person,
      counterAccountId: c.counterAccountId,
      holding: c.holding,
      confirmations: 3,
      contradictions: 0,
      updatedAt: now,
      always: true,
    };
    return [...rules.filter((x) => !(x.key === key && x.direction === row.direction)), rule];
  }
  const same = (r: UserRule) =>
    r.eventType === c.eventType && (r.category ?? null) === (c.category ?? null) && (r.person ?? null) === (c.person ?? null) &&
    (r.counterAccountId ?? null) === (c.counterAccountId ?? null) && (r.holding ?? null) === (c.holding ?? null);
  const current = rules.find((r) => r.key === key && r.direction === row.direction);
  if (!current) {
    const rule: UserRule = {
      id: `rule-${key}-${row.direction}`,
      key,
      direction: row.direction,
      eventType: c.eventType,
      category: c.category,
      person: c.person,
      counterAccountId: c.counterAccountId,
      holding: c.holding,
      confirmations: 1,
      contradictions: 0,
      updatedAt: now,
    };
    return [...rules, rule];
  }
  if (same(current)) return rules.map((r) => (r === current ? { ...r, confirmations: r.confirmations + 1, updatedAt: now } : r));
  // A different answer: record the contradiction; once it outweighs the old answer, the new one takes over.
  const contradictions = current.contradictions + 1;
  if (contradictions >= current.confirmations) {
    return rules.map((r) =>
      r === current
        ? { ...r, eventType: c.eventType, category: c.category, person: c.person, counterAccountId: c.counterAccountId, holding: c.holding, confirmations: 1, contradictions: 0, updatedAt: now, always: false }
        : r,
    );
  }
  return rules.map((r) => (r === current ? { ...r, contradictions, updatedAt: now } : r));
}

/* ---------------- Built-in knowledge ---------------- */

interface MerchantRule {
  re: RegExp;
  name: string;
  category: string;
}

/** Well-known merchants. Matching a name here is strong evidence for an expense in that category. */
const MERCHANTS: MerchantRule[] = [
  // Order matters: the first match wins, so the specific (a bar, a wine shop) comes before the general (food).
  { re: /\b(wines?|wine shop|wine mart|liquor|liquors|beer|beer shop|bar ?& ?restaurant|pub|brewery|brewing|spirits|daru|theka|bottle shop|tasmac|bevco|living liquidz|tonique)\b/, name: "", category: "Alcohol" },
  { re: /\b(paan|pan shop|pan ?bhandar|pan ?corner|pan ?house|tobacco|cigarettes?|cigars?|beedi|bidi|gutkha|smoke shop|hookah|vape)\b/, name: "", category: "Smoking" },
  { re: /\b(petrol|diesel|fuel|fuels|filling station|filling stn|petrol pump|service station|cng|nayara|essar oil|jio-?bp|indian oil|iocl|hpcl|bpcl|bharat petroleum|hindustan petroleum|shell)\b/, name: "", category: "Petrol" },
  { re: /\b(zepto|blinkit|bigbasket|big basket|bbnow|dmart|d-mart|avenue supermarts|jiomart|instamart|grofers|more retail|reliance fresh|reliance smart|smart bazaar|spencer'?s?|nature'?s basket|star bazaar|vishal mega mart|kirana|provision|provisions|general store|general stores|supermarket|super market|hypermarket|grocery|groceries|grocer|vegetables?|sabzi|sabji|fruits?|dairy|milk|doodh|amul|mother dairy|nandini|ration)\b/, name: "", category: "Grocery" },
  { re: /\b(swiggy|zomato|eatsure|dominos?|mcdonald'?s?|kfc|pizza hut|starbucks|burger king|box8|faasos|behrouz|barbeque nation|cafe coffee day|chaayos|subway|haldiram'?s?|restaurant|restro|resto|dhaba|cafe|caf[eé]|canteen|mess|bakery|bakers|sweets|mithai|tea stall|chai|juice|ice ?cream|food court|biryani|tiffin|eatery|kitchen)\b/, name: "", category: "Food" },
  { re: /\b(amazon|amzn|flipkart|myntra|ajio|meesho|nykaa|tata cliq|croma|reliance digital|vijay sales|decathlon|ikea|lifestyle|westside|pantaloons|max fashion|trends|h&m|zara|uniqlo|snapdeal|footwear|bata|fashion|garments?|textiles?|clothing|electronics|mobile (shop|store|point)|stationery)\b/, name: "", category: "Shopping" },
  { re: /\b(uber|ola|olacabs|rapido|meru|blusmart|namma yatri|redbus|fastag|nhai|toll|toll plaza|parking|dmrc|bmtc|best undertaking|metro rail|metro card|auto rickshaw|cab|taxi)\b/, name: "", category: "Transport" },
  { re: /\b(irctc|makemytrip|goibibo|cleartrip|yatra|ixigo|easemytrip|indigo|air india|vistara|spicejet|akasa|airbnb|oyo|agoda|booking\.com|treebo|fabhotels)\b/, name: "", category: "Travel" },
  { re: /\b(netflix|spotify|hotstar|jiohotstar|disney|prime video|primevideo|amazon prime|youtube premium|youtube|jiocinema|sonyliv|zee5|gaana|wynk|apple\.com|apple media|apple services|itunes|icloud|google (one|play|storage)|chatgpt|openai|anthropic|claude\.ai|github|adobe|canva|notion|linkedin|audible|kindle unlimited|microsoft 365|office 365|dropbox|zoom|figma|grammarly|duolingo|hostinger|godaddy|subscription|subscr|membership)\b/, name: "", category: "Subscriptions" },
  { re: /\b(bookmyshow|pvr|inox|cinepolis|cinema|movies?|playstation|xbox|steam|gaming|amusement|water park)\b/, name: "", category: "Entertainment" },
  { re: /\b(jio|reliance jio|airtel|bharti airtel|vodafone|vi prepaid|bsnl|act fibernet|hathway|tata sky|tata play|dish tv|d2h|dth|bescom|msedcl|mseb|tneb|tata power|adani electricity|bses|torrent power|mahanagar gas|indraprastha gas|indane|hp gas|bharat gas|gas cylinder|lpg|water board|water bill|electricity|light bill|broadband|wifi|postpaid|recharge|insurance|lic of india|lic premium|hdfc life|icici prudential|star health|max life|property tax)\b/, name: "", category: "Bills" },
  { re: /\b(apollo|pharmeasy|1mg|tata 1mg|netmeds|medplus|practo|cult\.?fit|gym|fitness|fortis|manipal hospital|max hospital|diagnostics?|pathology|path lab|lab|pharmacy|pharma|chemist|chemists|medical|medicals|medicos?|medical store|hospital|clinic|dental|dentist|doctor|dr\.? |eye care|lenskart)\b/, name: "", category: "Health" },
];

const SALARY = /\b(salary|sal cr|payroll|stipend)\b/i;
const INTEREST = /\b(int\.? ?pd|int\.? ?paid|interest (paid|credit|cr)|credit interest|savings interest|int on|int cr|interest)\b/i;
const BANK_CHARGE = /\b(sms (charges|chrg|alert)|chrg|charges?|annual fee|amc|min(imum)? bal(ance)? (charge|penalty)|gst|service tax|debit card (fee|charges)|atm (fee|charges)|folio charges|late fee|processing fee|cgst|sgst|igst)\b/i;
const ATM = /\b(atm|cash wdl|cash withdrawal|nwd|cwdr|cash w\/d)\b/i;
const CARD_PAYMENT = /\b(credit card|cc payment|card payment|cc bill|ccbill|cred club|cred\.club|billdesk.*card|card bill|autopay.*card)\b/i;
const EMI = /\b(emi|loan (repay|instal)|loan a\/c|nach.*loan|home loan|car loan|personal loan|bajaj finance|bajaj finserv|hdb financial|tata capital|fullerton)\b/i;
const INVEST = /\b(zerodha|groww|upstox|kuvera|coin by zerodha|paytm money|et money|angel (one|broking)|icici direct|hdfc securities|5paisa|smallcase|sip|mutual fund|mf purchase|nps|ppf|elss|bse star|nse clearing|ccil|indian clearing)\b/i;
const SELL = /\b(redemption|redeem|sale proceeds|sell proceeds|mf redemption|sip redemption)\b/i;
const RENT = /\b(rent|house rent|pg rent)\b/i;
const MAINTENANCE = /\b(maintenance|maint|society|repairs?|servicing|plumber|electrician|carpenter)\b/i;
const REFUND = /\b(refund\w*|reversal|reversed|rev|cashback|cash back|chargeback|\w*cradj\w*|credit adj\w*)\b/i;
const REIMBURSE = /\b(reimb\w*|expense claim|claim settle\w*)\b/i;

function merchantCategory(text: string): string | null {
  for (const m of MERCHANTS) if (m.re.test(text)) return m.category;
  return null;
}

const investmentName = (row: StatementRow): string => {
  const t = `${row.normalized.counterparty} ${row.normalizedDescription}`.toLowerCase();
  if (/zerodha|coin/.test(t)) return "Zerodha";
  if (/groww/.test(t)) return "Groww";
  if (/upstox/.test(t)) return "Upstox";
  if (/kuvera/.test(t)) return "Kuvera";
  if (/\bnps\b/.test(t)) return "NPS";
  if (/\bppf\b/.test(t)) return "PPF";
  if (/mutual fund|\bmf\b|\bsip\b/.test(t)) return "Mutual funds";
  return row.normalized.counterparty || "Investments";
};

export interface RuleContext {
  userRules: UserRule[];
  people: { name: string }[];
  relationships: Relationship[];
  /** Account ids the importer can point transfers at. */
  accountIds: { cash?: string; creditCard?: string; loan?: string };
}

/** Below this, an unexplained payment to an individual is suggested as a purchase rather than a loan. */
const SMALL_PAYMENT_MINOR = 100_000;
/** A reading nothing in the line supports: shown as the suggestion, but below the review line so the person decides. */
export const UNPROVEN_DEFAULT_CONFIDENCE = 0.6;

/* ---------------- The classifier ---------------- */

/**
 * Deterministic classification, no AI: taught rules first, then what the book knows about the
 * people involved, then built-in knowledge. Returns null when nothing here is confident enough
 * to say anything useful (those rows go to the AI, and failing that, to review).
 */
export function classifyByRules(row: StatementRow, ctx: RuleContext): Classification | null {
  const text = `${row.normalized.counterparty} ${row.normalizedDescription} ${row.rawDescription}`.toLowerCase();
  const credit = row.direction === "credit";

  // Money coming back says so in the narration; that beats anything learned about the sender
  // (an employer's reimbursement is not salary, a shop's refund is not income).
  if (credit && REIMBURSE.test(text)) {
    return make("rule", "INCOME", 0.9, "A reimbursement: money back, not earnings.", { category: "Reimbursement", merchant: row.normalized.counterparty, alternatives: ["LENDING_REPAYMENT"] });
  }
  if (credit && REFUND.test(text)) {
    return make("rule", "INCOME", 0.88, "A refund or reversal: money back, so it lowers your spending rather than counting as earned.", {
      category: "Refund",
      merchant: row.normalized.counterparty,
      alternatives: ["TRANSFER", "LENDING_REPAYMENT"],
    });
  }

  const learned = applyUserRule(row, ctx.userRules);
  if (learned) return learned;
  const mode = row.normalized.mode;

  // Cash withdrawals are money moving from the bank into the wallet.
  if (!credit && ATM.test(text) && !/\batm (fee|charges)\b/i.test(text)) {
    return make("rule", "TRANSFER", 0.96, "Cash withdrawal: money moved from this account into cash.", {
      counterAccountId: ctx.accountIds.cash ?? null,
      alternatives: ["EXPENSE"],
    });
  }

  if (!credit && BANK_CHARGE.test(text) && !merchantCategory(text) && !/\b(emi|loan)\b/i.test(text)) {
    return make("rule", "EXPENSE", 0.95, "Bank fee or tax.", { category: "Bills", merchant: "Bank charges" });
  }

  if (credit && SALARY.test(text)) return make("rule", "INCOME", 0.97, "Salary credit.", { category: "Salary", merchant: row.normalized.counterparty, alternatives: ["TRANSFER"] });
  if (credit && INTEREST.test(text) && !/\bloan\b/i.test(text)) return make("rule", "INCOME", 0.97, "Interest credited by the bank.", { category: "Interest", merchant: "Interest" });

  if (!credit && CARD_PAYMENT.test(text)) {
    return make("rule", "CREDIT_CARD_PAYMENT", ctx.accountIds.creditCard ? 0.93 : 0.8, "Credit card bill payment.", {
      counterAccountId: ctx.accountIds.creditCard ?? null,
      alternatives: ["EXPENSE", "TRANSFER"],
    });
  }

  if (!credit && EMI.test(text)) {
    return make("rule", "LOAN_REPAYMENT", ctx.accountIds.loan ? 0.9 : 0.8, "Loan EMI.", { counterAccountId: ctx.accountIds.loan ?? null, alternatives: ["EXPENSE"] });
  }

  if (!credit && INVEST.test(text)) {
    return make("rule", "INVESTMENT", 0.93, "Money sent to an investment platform or scheme.", { holding: investmentName(row), alternatives: ["EXPENSE", "TRANSFER"] });
  }
  if (credit && (SELL.test(text) || (INVEST.test(text) && !SALARY.test(text)))) {
    return make("rule", "INVESTMENT_SELL", 0.85, "Money received from an investment platform.", { holding: investmentName(row), alternatives: ["INCOME", "TRANSFER"] });
  }


  // Known merchants and people
  const knownPerson = findPerson(row.normalized.counterparty, ctx.people);
  const cat = merchantCategory(text);
  if (cat && !credit) {
    return make("rule", "EXPENSE", 0.96, `${row.normalized.counterparty || "This merchant"} is a ${cat.toLowerCase()} merchant.`, {
      category: cat,
      merchant: row.normalized.counterparty,
    });
  }

  // An unknown single word ("Dunzo") is more likely a business than a person: leave it to the AI / review.
  const key = row.normalized.counterpartyKey;
  // Only a payment handle (UPI / IMPS) tells a person from a company; a bare NEFT name could be either, so the AI gets that one.
  const vpa = row.normalized.vpa;
  const unknownPerson = (!!vpa || mode === "UPI") && looksLikePerson(key, vpa) && (key.includes(" ") || /^\d{10}@/.test(vpa ?? ""));
  const person = knownPerson ?? (unknownPerson ? row.normalized.counterparty : null);
  if (person) return classifyPerson(row, person, !!knownPerson, ctx, text);

  if (!credit && MAINTENANCE.test(text)) return make("rule", "EXPENSE", 0.86, "Maintenance or repairs.", { category: "Maintenance", merchant: row.normalized.counterparty, alternatives: ["TRANSFER"] });
  if (!credit && RENT.test(text)) return make("rule", "EXPENSE", 0.88, "Mentions rent.", { category: "Rent", merchant: row.normalized.counterparty, alternatives: ["TRANSFER"] });
  return null;
}

function classifyPerson(row: StatementRow, name: string, known: boolean, ctx: RuleContext, text: string): Classification {
  const credit = row.direction === "credit";
  const rel = ctx.relationships.find((r) => r.name.toLowerCase() === name.toLowerCase());

  if (!credit && rel && rel.iOweMinor > 0) {
    const exact = row.amountMinor === rel.iOweMinor;
    const within = row.amountMinor <= rel.iOweMinor;
    if (within) {
      return make("relationship", "BORROWING_REPAYMENT", exact ? 0.94 : 0.9, `You owe ${name} ${exact ? "exactly this amount" : "more than this"}, so this looks like paying them back.`, {
        person: name,
        alternatives: ["EXPENSE", "MONEY_LENT"],
      });
    }
  }
  if (credit && rel && rel.owedToMeMinor > 0) {
    const exact = row.amountMinor === rel.owedToMeMinor;
    if (row.amountMinor <= rel.owedToMeMinor) {
      return make("relationship", "LENDING_REPAYMENT", exact ? 0.94 : 0.9, `${name} owes you ${exact ? "exactly this amount" : "more than this"}, so this looks like them paying you back.`, {
        person: name,
        alternatives: ["INCOME", "MONEY_BORROWED"],
      });
    }
  }

  if (!credit && MAINTENANCE.test(text)) {
    return make("rule", "EXPENSE", 0.88, `Maintenance or repairs paid to ${name}.`, { category: "Maintenance", merchant: name, alternatives: ["MONEY_LENT", "BORROWING_REPAYMENT"] });
  }
  if (!credit && RENT.test(text)) {
    return make("rule", "EXPENSE", 0.9, `Rent paid to ${name}.`, { category: "Rent", merchant: name, alternatives: ["MONEY_LENT", "BORROWING_REPAYMENT"] });
  }

  // A small UPI payment to someone we know nothing about is often an everyday purchase (a tea stall, an auto
  // ride), but nothing in the line says so. Offered as a one-click suggestion and left for the AI or the person:
  // never imported on that assumption alone.
  if (!credit && !known && row.amountMinor < SMALL_PAYMENT_MINOR) {
    return make("rule", "EXPENSE", UNPROVEN_DEFAULT_CONFIDENCE, `Small payment to ${name}. Nothing says what it was for — probably an everyday purchase, or a loan or repayment.`, {
      category: "Other",
      merchant: name,
      tentative: true,
      alternatives: ["MONEY_LENT", "BORROWING_REPAYMENT", "TRANSFER"],
    });
  }

  // No corroboration: a payment between two people is ambiguous by nature. Never trusted beyond 0.79.
  const mode = row.normalized.mode;
  const hint = mode === "UPI" || mode === "IMPS" || mode === "NEFT" ? "" : " (no payment mode shown)";
  return credit
    ? make("rule", "LENDING_REPAYMENT", known ? 0.7 : 0.55, `Money from ${name}${hint}. Could be a repayment, a gift, a loan to you or a reimbursement.`, {
        person: name,
        alternatives: ["INCOME", "MONEY_BORROWED", "REIMBURSEMENT"],
      })
    : make("rule", "MONEY_LENT", known ? 0.7 : 0.55, `Money sent to ${name}${hint}. Could be a loan, a repayment, a shared bill or a purchase.`, {
        person: name,
        alternatives: ["EXPENSE", "BORROWING_REPAYMENT", "TRANSFER"],
      });
}

/** Last resort when neither rules nor AI have an answer: a guess that is always sent for review. */
export function fallbackClassification(row: StatementRow): Classification {
  // Nothing recognised it. A small UPI debit is usually a purchase, so that is the suggestion, but it isn't assumed.
  if (row.direction === "debit" && row.amountMinor < SMALL_PAYMENT_MINOR && row.normalized.mode === "UPI") {
    return make("rule", "EXPENSE", UNPROVEN_DEFAULT_CONFIDENCE, "Not recognised. Probably a small purchase — confirm, or pick what it really was.", {
      category: "Other",
      merchant: row.normalized.counterparty,
      alternatives: ["MONEY_LENT", "BORROWING_REPAYMENT", "TRANSFER", "INVESTMENT"],
    });
  }
  return row.direction === "credit"
    ? make("rule", "INCOME", 0.4, "No rule recognised this and no AI answer was available.", { category: "Other income", merchant: row.normalized.counterparty, alternatives: ["TRANSFER", "LENDING_REPAYMENT", "MONEY_BORROWED"] })
    : make("rule", "EXPENSE", 0.4, "No rule recognised this and no AI answer was available.", { category: "Other", merchant: row.normalized.counterparty, alternatives: ["MONEY_LENT", "TRANSFER", "INVESTMENT"] });
}

/** The status a classification earns under the person's thresholds. Person-involving guesses can never be fully automatic. */
export function gate(c: Classification, auto: number, review: number): "auto" | "auto_flagged" | "review" {
  if (c.confidence >= auto) return "auto";
  if (c.confidence >= review) return "auto_flagged";
  return "review";
}
