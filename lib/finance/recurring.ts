import { addDays, daysBetween, monthEnd, toISODate } from "@/lib/domain/dates";
import { counterpartyKeyOf, looksLikePerson } from "@/lib/statements/normalize";
import { brandBySlug, GENERIC_SUBSCRIPTION, subscriptionBrandFor } from "./brands";
import type { Book, Ledger } from "./types";

/**
 * Finds recurring spending (rent, subscriptions, EMIs paid as expenses...) from
 * the user's own history: the same description, on a steady rhythm, for a
 * similar amount. Deterministic: same history in, same answer out.
 */

/** Narrations that show the bank takes the money by itself (a mandate). */
const AUTOPAY = /\b(nach|ach[ -]?d|ecs|e-?mandate|mandate|auto[ -]?pay|autodebit|standing instruction|si[ -]?(dr|debit))\b/i;

export type Frequency = "weekly" | "monthly" | "yearly";

/** A subscription is a service you keep paying for; the rest (rent, EMIs, utilities) are plain repeating payments. */
export type ChargeKind = "subscription" | "recurring";

/** Same service, same key: digits and punctuation never make two payments look like different things. */
export function merchantKey(description: string): { key: string; display: string; subscription: boolean; brand?: string } {
  const known = subscriptionBrandFor(description);
  if (known) return { key: known.slug, display: known.name, subscription: true, brand: known.slug };
  if (GENERIC_SUBSCRIPTION.test(description.toLowerCase())) return { key: "insurance", display: "Insurance", subscription: true };
  const letters = description.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  return { key: letters || description.toLowerCase(), display: description.trim(), subscription: false };
}

export interface RecurringCharge {
  key: string;
  name: string;
  categoryId: string;
  amountMinor: number;
  frequency: Frequency;
  kind: ChargeKind;
  /** Why it is called a subscription when it isn't a known service: the bank shows an auto-debit, or it simply repeats like one. */
  via?: "autopay" | "pattern";
  /** Slug of a recognised service, for its logo (/brands/<slug>.png). */
  brand?: string;
  /** The rhythm was assumed (you filed it under Subscriptions but there isn't enough history to tell). */
  assumed?: boolean;
  lastDate: string;
  nextDate: string;
  occurrences: number;
  /** What this costs per month on average. */
  monthlyEquivalentMinor: number;
}

const BANDS: Record<Frequency, { min: number; max: number }> = {
  weekly: { min: 6, max: 8 },
  monthly: { min: 24, max: 37 }, // billing dates drift around weekends and month lengths
  yearly: { min: 350, max: 380 },
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Same day next month (clamped, so Jan 31 → Feb 28). */
function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const ym = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`;
  const last = Number(monthEnd(ym).slice(8, 10));
  return toISODate(new Date(target.getFullYear(), target.getMonth(), Math.min(d, last)));
}

function nextAfter(last: string, frequency: Frequency): string {
  if (frequency === "weekly") return addDays(last, 7);
  return addMonths(last, frequency === "monthly" ? 1 : 12);
}

function monthlyEquivalent(amountMinor: number, frequency: Frequency): number {
  if (frequency === "monthly") return amountMinor;
  if (frequency === "weekly") return Math.round((amountMinor * 52) / 12);
  return Math.round(amountMinor / 12);
}

function classify(dates: string[], relaxed: boolean): Frequency | null {
  if (dates.length < 2) return null;
  const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
  for (const frequency of ["monthly", "weekly", "yearly"] as Frequency[]) {
    const band = BANDS[frequency];
    const inBand = gaps.filter((g) => g >= band.min && g <= band.max).length;
    // Monthly/weekly need 3 payments; yearly can be spotted from 2. A recognised subscription needs only 2 monthly ones.
    const needsGaps = frequency === "yearly" || (relaxed && frequency === "monthly") ? 1 : 2;
    if (gaps.length >= needsGaps && inBand / gaps.length >= 0.7 && median(gaps) >= band.min && median(gaps) <= band.max) {
      return frequency;
    }
  }
  return null;
}

interface Group {
  name: string;
  categoryId: string;
  subscription: boolean;
  explicit: boolean;
  autopay: boolean;
  brand?: string;
  items: { date: string; amountMinor: number }[];
}

/** Bank narrations are cut off differently month to month ("Razorpay" / "Razorpay Pv"): a name that starts another is the same payee. */
function mergeTruncatedNames(groups: Map<string, Group>): Map<string, Group> {
  const keys = [...groups.keys()].sort((a, b) => a.length - b.length);
  const root = new Map<string, string>();
  for (const k of keys) {
    const r = keys.find((o) => o !== k && o.length >= 6 && (k === o || k.startsWith(o + " ") || (k.startsWith(o) && o.length >= 8)) && !groups.get(o)!.brand && !groups.get(k)!.brand);
    root.set(k, r ? root.get(r) ?? r : k);
  }
  const merged = new Map<string, Group>();
  for (const [k, g] of groups) {
    const target = root.get(k) ?? k;
    const into = merged.get(target);
    if (!into) {
      merged.set(target, { ...g, items: [...g.items] });
    } else {
      into.items.push(...g.items);
      into.subscription ||= g.subscription;
      into.explicit ||= g.explicit;
      into.autopay ||= g.autopay;
      if (g.items.some((i) => i.date > into.items.reduce((m, x) => (x.date > m ? x.date : m), ""))) into.name = g.name;
    }
  }
  return merged;
}

/** One payee can have several products at different prices (Apple at ₹79 and ₹1,999): split by amount, so each is judged on its own rhythm. */
function splitByAmount(items: Group["items"], factor: number): Group["items"][] {
  const sorted = [...items].sort((a, b) => a.amountMinor - b.amountMinor);
  const clusters: Group["items"][] = [];
  for (const item of sorted) {
    const current = clusters[clusters.length - 1];
    if (current && item.amountMinor <= current[0].amountMinor * factor) current.push(item);
    else clusters.push([item]);
  }
  return clusters;
}

const looksLikePersonName = (description: string, people: { name: string }[]) =>
  people.some((p) => p.name.toLowerCase() === description.trim().toLowerCase()) ||
  // A single word ("Razorpay", "EarlySalary") is a company; a person is a first and last name.
  (counterpartyKeyOf(description).includes(" ") && looksLikePerson(counterpartyKeyOf(description), null));

export function detectRecurring(book: Book, ledger: Ledger, today: string): RecurringCharge[] {
  const applied = new Set(ledger.entries.map((e) => e.sourceId));
  const raw = new Map<string, Group>();

  for (const e of book.events) {
    if (e.type !== "expense" || !applied.has(e.id)) continue;
    const description = e.description?.trim();
    if (!description) continue;
    const merchant = merchantKey(description);
    const { key, display } = merchant;
    // Anything the person filed under Subscriptions counts, even a service we don't know by name.
    const explicit = e.categoryId === "subscriptions";
    const group = raw.get(key) ?? { name: display, categoryId: e.categoryId, subscription: false, explicit: false, autopay: false, brand: merchant.brand, items: [] };
    group.subscription ||= merchant.subscription || explicit;
    group.explicit ||= explicit;
    if (e.sources?.some((x) => x.narration && AUTOPAY.test(x.narration))) group.autopay = true;
    group.items.push({ date: e.date, amountMinor: e.amountMinor });
    group.name = display;
    group.categoryId = e.categoryId;
    raw.set(key, group);
  }

  const found: RecurringCharge[] = [];
  for (const [groupKey, group] of mergeTruncatedNames(raw)) {
    // Something the person filed as a subscription is kept whole unless the prices are wildly different (₹79 vs ₹1,999).
    const trusted = group.explicit || (!!group.brand && !brandBySlug(group.brand)?.ambiguous);
    splitByAmount(group.items.filter((i) => i.date <= today), trusted ? 3 : 1.35).forEach((cluster, clusterIndex) => {
      const items = [...cluster].sort((a, b) => (a.date < b.date ? -1 : 1));
      if (items.length === 0) return;
      let frequency = classify(items.map((i) => i.date), group.subscription || group.autopay);
      let assumed = false;
      // Filing something under Subscriptions is the person's own say-so: believe it, even from one payment.
      if (!frequency && trusted) {
        frequency = "monthly";
        assumed = true;
      }
      if (!frequency) return;

      const typical = median(items.map((i) => i.amountMinor));
      // Subscriptions change price now and then; other repeating payments should stay close to the same amount.
      const tolerance = group.subscription ? 0.6 : 0.3;
      if (!trusted && items.some((i) => Math.abs(i.amountMinor - typical) > typical * tolerance)) return; // amounts too erratic

      const last = items[items.length - 1];
      const patience = trusted ? (assumed ? 100 : 75) : BANDS[frequency].max * 1.6;
      if (daysBetween(last.date, today) > patience) return; // stopped; no longer a commitment

      // Not a known service, but the bank debits it by mandate, or it repeats like clockwork: a subscription too.
      // (Never for a person: a monthly payment to someone is rent or help, not a subscription.)
      const closeToTypical = items.filter((i) => Math.abs(i.amountMinor - typical) <= typical * 0.05).length;
      const steady = items.length >= 3 && closeToTypical >= Math.ceil(items.length * 0.6);
      const person = looksLikePersonName(group.name, book.people);
      const via: RecurringCharge["via"] = group.subscription
        ? undefined
        : group.autopay
          ? "autopay"
          : frequency === "monthly" && steady && group.categoryId !== "rent" && !person
            ? "pattern"
            : undefined;

      found.push({
        key: clusterIndex === 0 ? groupKey : `${groupKey}#${Math.round(typical)}`,
        name: group.name,
        categoryId: group.categoryId,
        amountMinor: last.amountMinor,
        frequency,
        kind: group.subscription || via ? "subscription" : "recurring",
        ...(via ? { via } : {}),
        ...(group.brand ? { brand: group.brand } : {}),
        ...(assumed ? { assumed: true } : {}),
        lastDate: last.date,
        nextDate: nextAfter(last.date, frequency),
        occurrences: items.length,
        monthlyEquivalentMinor: monthlyEquivalent(last.amountMinor, frequency),
      });
    });
  }
  return found.sort((a, b) => (a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : 0));
}

export const fixedCommitmentsMinor = (charges: RecurringCharge[]) =>
  charges.reduce((t, c) => t + c.monthlyEquivalentMinor, 0);

/** Charges expected within the next `days` days (and anything a few days overdue that isn't recorded yet). */
export function upcomingCharges(charges: RecurringCharge[], today: string, days = 30): RecurringCharge[] {
  return charges.filter((c) => {
    const until = daysBetween(today, c.nextDate);
    return until >= -3 && until <= days;
  });
}

/** Just the subscriptions, costliest first. */
export const subscriptionsOf = (charges: RecurringCharge[]) =>
  charges.filter((c) => c.kind === "subscription").sort((a, b) => b.monthlyEquivalentMinor - a.monthlyEquivalentMinor);
