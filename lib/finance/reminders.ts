import { daysBetween } from "@/lib/domain/dates";
import { isStopped, nextDue, type BillsData, type Repeat } from "./bills";
import { cardDueDates, type CardDue } from "./card-bill-status";
import type { RecurringCharge } from "./recurring";
import type { Book } from "./types";

export interface Reminder {
  /** Stable for one bill and date, so a notification is sent once per stage, not on every visit. */
  id: string;
  kind: "card" | "subscription" | "custom";
  title: string;
  dueDate: string;
  /** Whole days from today to the due date; negative once it has passed. */
  days: number;
  /** What's left to pay (a card's unpaid bill) or what it usually costs (a subscription, or a bill you added); 0 when unknown. */
  amountMinor: number;
  accountId?: string;
  /** Lowest payment that avoids a late fee, when the statement printed one. */
  minimumMinor?: number;
  /** Which thing this is, for moving its date: `card:<id>`, `sub:<key>`, or a custom bill's id. */
  baseKey: string;
  /** The date as found or added, before any move by the user. */
  originalDate: string;
  /** Set when the user moved this date. */
  moved?: boolean;
  /** A subscription's service logo slug and category, for its picture. */
  brand?: string;
  categoryId?: string;
  /** A subscription's last charge. */
  lastDate?: string;
  /** A subscription you said is on autopay. */
  autopay?: boolean;
  /** For a bill you added. */
  billId?: string;
  repeat?: Repeat;
  /** The day of the month a repeating bill is meant for (see Bill.day). */
  day?: number;
}

/** How far ahead each kind shows up on Home. Cards matter sooner: a missed bill costs interest. */
export const CARD_WINDOW_DAYS = 7;
export const SUBSCRIPTION_WINDOW_DAYS = 3;
export const CUSTOM_WINDOW_DAYS = 7;
/** A card bill overdue longer than this is old news, not a reminder. */
const OVERDUE_LIMIT_DAYS = 30;

interface CardStatementSource {
  accountId?: string;
  status?: string;
  cardBill?: Parameters<typeof cardDueDates>[2][number];
}

export interface BillOptions {
  /** Bills you added, and dates you moved. */
  data?: BillsData;
  /** List everything tracked, however far off, for managing dates; Home only shows what's near. */
  all?: boolean;
}

/**
 * The bills coming up (or just missed), soonest first: unpaid card bills, subscriptions about to renew and the
 * bills you added. A moved date replaces the found one while the found one is unchanged.
 */
export function upcomingBills(
  book: Book,
  imports: CardStatementSource[],
  subscriptions: RecurringCharge[],
  today: string,
  { data = { bills: [], overrides: {} }, all = false }: BillOptions = {},
): Reminder[] {
  const out: Reminder[] = [];
  const dateOf = (baseKey: string, found: string) => {
    const o = data.overrides[baseKey];
    return o && o.from === found ? { date: o.to, moved: true } : { date: found, moved: false };
  };

  for (const account of book.accounts) {
    if (account.type !== "credit_card") continue;
    const statements = imports.filter((i) => i.accountId === account.id && i.status !== "FAILED").map((i) => i.cardBill ?? {});
    const due: CardDue | undefined = cardDueDates(book, account.id, statements).find((d) => d.latest);
    if (!due || due.remainingMinor <= 0) continue;
    const baseKey = `card:${account.id}`;
    const { date, moved } = dateOf(baseKey, due.dueDate);
    const days = daysBetween(today, date);
    if (!all && (days > CARD_WINDOW_DAYS || days < -OVERDUE_LIMIT_DAYS)) continue;
    out.push({
      id: `${baseKey}:${date}`,
      kind: "card",
      title: `${account.name} bill`,
      dueDate: date,
      days,
      amountMinor: due.remainingMinor,
      accountId: account.id,
      minimumMinor: due.minimumDueMinor,
      baseKey,
      originalDate: due.dueDate,
      moved,
    });
  }

  // A bill you added for the same service replaces the detected subscription, so it isn't listed twice.
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const ownNames = data.bills.map((b) => squash(b.name)).filter((n) => n.length >= 3);
  const covered = (name: string) => {
    const n = squash(name);
    return n.length >= 3 && ownNames.some((o) => o === n || o.includes(n) || n.includes(o));
  };

  for (const s of subscriptions) {
    const baseKey = `sub:${s.key}`;
    if (isStopped(data.stopped, baseKey, s.lastDate)) continue; // not active: a one-off, or cancelled (until it charges again)
    if (covered(s.name)) continue;
    const { date, moved } = dateOf(baseKey, s.nextDate);
    const days = daysBetween(today, date);
    if (!all && (days < 0 || days > SUBSCRIPTION_WINDOW_DAYS)) continue;
    out.push({ id: `${baseKey}:${date}`, kind: "subscription", title: s.name, dueDate: date, days, amountMinor: s.amountMinor, baseKey, originalDate: s.nextDate, moved, brand: s.brand, categoryId: s.categoryId, lastDate: s.lastDate, autopay: !!data.autopay?.[baseKey], repeat: s.frequency });
  }

  for (const b of data.bills) {
    const days = daysBetween(today, b.dueDate);
    if (!all && days > CUSTOM_WINDOW_DAYS) continue; // a bill you added stays until it's marked paid, however overdue
    out.push({
      id: `bill:${b.id}:${b.dueDate}`,
      kind: "custom",
      title: b.name,
      dueDate: b.dueDate,
      days,
      amountMinor: b.amountMinor ?? 0,
      baseKey: b.id,
      originalDate: b.dueDate,
      billId: b.id,
      repeat: b.repeat,
      day: b.day,
    });
  }

  return out.sort((a, b) => a.days - b.days || b.amountMinor - a.amountMinor);
}

/**
 * How urgent a reminder is, for deciding when to send a notification: 0 not yet, 1 within three days,
 * 2 due today or tomorrow, 3 overdue. A notification goes out each time a bill reaches a higher stage.
 */
export function stageOf(days: number): 0 | 1 | 2 | 3 {
  if (days < 0) return 3;
  if (days <= 1) return 2;
  if (days <= 3) return 1;
  return 0;
}

/** "Due today", "Due tomorrow", "Due in 3 days", "2 days overdue". */
export function dueWording(days: number): string {
  if (days < -1) return `${-days} days overdue`;
  if (days === -1) return "1 day overdue";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

/**
 * Where bills fall on the calendar between two dates: each one on its due date, and on every date it repeats to
 * after that (rent on the 5th of every month). Card bills fall once, on their due date. Bills are listed in the
 * order given, so the soonest-due comes first.
 */
export function billDatesBetween(reminders: Reminder[], from: string, to: string): Map<string, Reminder[]> {
  const out = new Map<string, Reminder[]>();
  const add = (date: string, r: Reminder) => out.set(date, [...(out.get(date) ?? []), r]);
  for (const r of reminders) {
    const repeat = r.kind === "card" ? "none" : (r.repeat ?? "none");
    if (repeat === "none") {
      if (r.dueDate >= from && r.dueDate <= to) add(r.dueDate, r);
      continue;
    }
    for (let k = 0, date = r.dueDate; date <= to && k < 2000; date = nextDue(r.dueDate, repeat, ++k, r.day)) {
      if (date >= from) add(date, r);
    }
  }
  return out;
}
