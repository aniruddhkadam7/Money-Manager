import { useSyncExternalStore } from "react";
import { appStorage } from "@/lib/cloud/sync";
import { addDays, monthEnd, shiftMonth } from "@/lib/domain/dates";
import { newId } from "@/lib/domain/id";

export type Repeat = "none" | "weekly" | "monthly" | "yearly";

export const REPEAT_LABEL: Record<Repeat, string> = { none: "Once", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };

/** A bill you track yourself: rent, an EMI, insurance, a tax date. `dueDate` is the next time it falls due. */
export interface Bill {
  id: string;
  name: string;
  /** What you expect to pay, in paise; optional (a premium may vary). */
  amountMinor?: number;
  dueDate: string;
  repeat: Repeat;
  /** The day of the month it is meant for (31 for a bill due on the 31st), kept as short months move its date. */
  day?: number;
}

/** A moved due date for something found automatically (a card's bill, a subscription). It holds only while the original date is still the one found, so the next statement or renewal starts fresh. */
export interface DateOverride {
  from: string;
  to: string;
}

export interface BillsData {
  bills: Bill[];
  /** By the thing's key: `card:<accountId>` or `sub:<key>`. */
  overrides: Record<string, DateOverride>;
  /**
   * Subscriptions found automatically that are not active (a one-off, or cancelled): no reminders, no calendar, not in
   * the Subscriptions list. By the thing's key (`sub:<key>`), with its name and the date of its last charge when it
   * was stopped. A charge after that date means it came back (see isStopped).
   */
  stopped?: Record<string, StoppedSubscription>;
  /** Subscriptions you said are on autopay: they renew by themselves, so they stay tracked. By the same key. */
  autopay?: Record<string, true>;
}

export interface StoppedSubscription {
  name: string;
  /** Its last charge when you stopped it. */
  lastDate: string;
}

/**
 * Whether a subscription is still marked not active: it is until a charge turns up after the one it was stopped at,
 * which means you signed up again. Then it counts as active, and the app tracks it as it would any other.
 */
export function isStopped(stopped: BillsData["stopped"], baseKey: string, lastChargeDate: string): boolean {
  const s = stopped?.[baseKey];
  return !!s && lastChargeDate <= s.lastDate;
}

/**
 * A date moved forward by `steps` of `repeat`. A monthly or yearly bill keeps its day of the month (`day`, the
 * one it was set for) and falls on the last day of shorter months, so one due on the 31st is 28 Feb, then 31 Mar.
 */
export function nextDue(date: string, repeat: Repeat, steps = 1, day?: number): string {
  if (repeat === "weekly") return addDays(date, 7 * steps);
  if (repeat === "none") return date;
  const ym = shiftMonth(date.slice(0, 7), (repeat === "monthly" ? 1 : 12) * steps);
  const last = Number(monthEnd(ym).slice(8));
  return `${ym}-${String(Math.min(day ?? Number(date.slice(8)), last)).padStart(2, "0")}`;
}

/**
 * Marks a bill paid: a repeating one moves on to its first date after `today` (paying late skips the missed
 * cycles), a one-off one is finished and goes away.
 */
export function markPaid(bill: Bill, today: string): Bill | null {
  if (bill.repeat === "none") return null;
  const day = bill.day ?? Number(bill.dueDate.slice(8));
  let steps = 1;
  while (nextDue(bill.dueDate, bill.repeat, steps, day) <= today) steps++;
  return { ...bill, day, dueDate: nextDue(bill.dueDate, bill.repeat, steps, day) };
}

export const newBill = (draft: Omit<Bill, "id">): Bill => ({ id: newId(), ...draft });

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The bill an entry renews: the one it's linked to, else one you added with the same name ("Airtel" for an entry
 * described "Airtel"), so a payment updates the bill you already track instead of adding a second one.
 */
export function billFor(data: BillsData, link: { billId?: string; name?: string }): Bill | undefined {
  const linked = link.billId ? data.bills.find((b) => b.id === link.billId) : undefined;
  if (linked) return linked;
  const n = squash(link.name ?? "");
  return n.length >= 3 ? data.bills.find((b) => squash(b.name) === n) : undefined;
}

/**
 * Sets the next due (or expiry) date of the bill an entry renews, adding the bill if there's none yet. A new one is
 * once-only (a prepaid plan's expiry); a bill you set to repeat keeps repeating from the new date.
 */
export function setBillDue(data: BillsData, link: { billId?: string; name: string; dueDate: string; amountMinor?: number }): { data: BillsData; billId: string } {
  const existing = billFor(data, link);
  const amount = link.amountMinor ? { amountMinor: link.amountMinor } : {};
  if (existing) {
    const updated: Bill = { ...existing, ...amount, dueDate: link.dueDate, day: Number(link.dueDate.slice(8)) };
    return { data: { ...data, bills: data.bills.map((b) => (b.id === existing.id ? updated : b)) }, billId: existing.id };
  }
  const bill: Bill = { id: link.billId ?? newId(), name: link.name, dueDate: link.dueDate, repeat: "none", ...amount };
  return { data: { ...data, bills: [...data.bills, bill] }, billId: bill.id };
}

const KEY = "money-manager:v1:bills";
const listeners = new Set<() => void>();
let cached: { raw: string | null; data: BillsData } | null = null;
const EMPTY: BillsData = { bills: [], overrides: {}, stopped: {}, autopay: {} };

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

function read(): BillsData {
  const raw = typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
  if (cached?.raw === raw) return cached.data;
  let data: BillsData = EMPTY;
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<BillsData>) : {};
    data = {
      bills: (parsed.bills ?? []).filter((b): b is Bill => !!b && typeof b.id === "string" && typeof b.name === "string" && isDate(b.dueDate) && b.repeat in REPEAT_LABEL),
      overrides: Object.fromEntries(Object.entries(parsed.overrides ?? {}).filter(([, o]) => isDate(o?.from) && isDate(o?.to))),
      autopay: Object.fromEntries(Object.entries(parsed.autopay ?? {}).filter(([, v]) => v === true)),
      stopped: Object.fromEntries(
        Object.entries(parsed.stopped ?? {}).flatMap(([k, v]): [string, StoppedSubscription][] =>
          typeof v === "string" ? [[k, { name: v, lastDate: "9999-12-31" }]] : v && typeof v.name === "string" && isDate(v.lastDate) ? [[k, v]] : [],
        ),
      ),
    };
  } catch {
    // Unreadable: start with none rather than break Home.
  }
  cached = { raw, data };
  return data;
}

export function saveBills(data: BillsData) {
  appStorage.setItem(KEY, JSON.stringify(data));
  for (const l of listeners) l();
}

/** Applies a change to the stored bills and dates. */
export function updateBills(change: (data: BillsData) => BillsData) {
  saveBills(change(read()));
}

/** The stored bills right now, for handlers that run later than the render that made them. */
export const currentBills = read;

export function useBills(): BillsData {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => EMPTY,
  );
}
