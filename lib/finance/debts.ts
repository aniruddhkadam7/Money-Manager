import { daysBetween } from "@/lib/domain/dates";
import { nextDue } from "./bills";
import type { BorrowEvent, DebtTerms, FinancialEvent } from "./types";

/** One thing you owe a person: what it was, what's still owed on it, and its terms. */
export interface OpenDebt {
  eventId: string;
  date: string;
  for: "money" | "service";
  description?: string;
  originalMinor: number;
  owedMinor: number;
  terms?: DebtTerms;
}

/** Where you stand with someone you owe: each debt still open, the nearest date, and interest so far. */
export interface PersonDebts {
  owedMinor: number;
  debts: OpenDebt[];
  /** The earliest "pay back by" among open debts. */
  dueDate?: string;
  /** The next instalment due, on debts paid back in instalments. */
  nextInstalment?: { date: string; amountMinor: number };
  /** Simple interest owed so far on open debts with interest, since each was taken or last paid towards. */
  interestSoFarMinor: number;
  /** What to pay next: the instalment (or, without one, everything owed), plus interest so far. */
  suggestedMinor: number;
}

const DAYS_PER_MONTH = 365.25 / 12;

/**
 * Everything you owe one person, from your entries: each debt (money borrowed, or a service on credit), paid down
 * oldest first by what you've paid back (interest parts aside), with its terms. Debts recorded from before tracking
 * count too. `today` dates interest and instalments.
 */
export function personDebts(events: FinancialEvent[], personId: string, today: string): PersonDebts {
  const mine = events.filter((e) => (e.type === "borrow" || e.type === "repayment_made") && e.personId === personId).sort((a, b) => a.date.localeCompare(b.date));
  const open: (OpenDebt & { lastPaid: string; paymentsSince: number })[] = [];

  for (const e of mine) {
    if (e.type === "borrow") {
      const b = e as BorrowEvent;
      open.push({
        eventId: b.id,
        date: b.date,
        for: b.for ?? "money",
        description: b.description,
        originalMinor: b.amountMinor,
        owedMinor: b.amountMinor,
        terms: b.terms,
        lastPaid: b.date,
        paymentsSince: 0,
      });
    } else if (e.type === "repayment_made") {
      let left = e.amountMinor - (e.interestMinor ?? 0);
      for (const d of open) {
        if (d.owedMinor <= 0) continue;
        d.paymentsSince++;
        d.lastPaid = e.date;
        const take = Math.min(left, d.owedMinor);
        d.owedMinor -= take;
        left -= take;
        if (left <= 0) break;
      }
    }
  }
  const still = open.filter((d) => d.owedMinor > 0);
  const owedMinor = still.reduce((t, d) => t + d.owedMinor, 0);

  const dueDate = still.map((d) => d.terms?.dueDate).filter((d): d is string => !!d).sort()[0];

  // Instalments: the next one is the first scheduled after the payments made so far on that debt.
  let nextInstalment: PersonDebts["nextInstalment"];
  for (const d of still) {
    const plan = d.terms?.instalments;
    if (!plan) continue;
    const date = nextDue(plan.firstDate, "monthly", d.paymentsSince, Number(plan.firstDate.slice(8)));
    const amountMinor = Math.min(plan.amountMinor, d.owedMinor);
    if (!nextInstalment || date < nextInstalment.date) nextInstalment = { date, amountMinor };
  }

  // Simple interest on what's still owed, from when each debt was taken or last paid towards, to today.
  let interestSoFarMinor = 0;
  for (const d of still) {
    const rate = d.terms?.interest;
    if (!rate) continue;
    const days = Math.max(0, daysBetween(d.lastPaid, today));
    const periods = rate.per === "month" ? days / DAYS_PER_MONTH : days / 365.25;
    interestSoFarMinor += Math.round(d.owedMinor * (rate.rateBps / 10000) * periods);
  }

  const principalNext = nextInstalment ? nextInstalment.amountMinor : owedMinor;
  return {
    owedMinor,
    debts: still.map((d) => ({ eventId: d.eventId, date: d.date, for: d.for, description: d.description, originalMinor: d.originalMinor, owedMinor: d.owedMinor, terms: d.terms })),
    dueDate,
    nextInstalment,
    interestSoFarMinor,
    suggestedMinor: principalNext + interestSoFarMinor,
  };
}

/** A debt's terms in a few words: "2% a month · ₹5,000 monthly from 1 Dec · by 31 Mar". */
export function termsWords(t: DebtTerms | undefined, money: (minor: number) => string, day: (iso: string) => string): string {
  if (!t) return "";
  return [
    t.interest && `${t.interest.rateBps / 100}% a ${t.interest.per}`,
    t.instalments && `${money(t.instalments.amountMinor)} monthly from ${day(t.instalments.firstDate)}`,
    t.dueDate && `by ${day(t.dueDate)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export const daysLate = (dueDate: string, today: string) => Math.max(0, daysBetween(dueDate, today));
