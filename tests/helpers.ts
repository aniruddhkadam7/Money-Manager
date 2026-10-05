import { addAccount, addEvent, ensureInvestment, ensurePerson, emptyBook, type Clock } from "@/lib/finance/book-ops";
import { buildLedger } from "@/lib/finance/engine";
import { deriveState, periodReport } from "@/lib/finance/state";
import type { AccountInput } from "@/lib/finance/book-ops";
import type { Book, EventDraft } from "@/lib/finance/types";

/** Rupees to paise. */
export const rs = (n: number) => Math.round(n * 100);

export function testClock(): Clock {
  let n = 0;
  return {
    now: () => `2026-01-01T00:00:${String(n++ % 60).padStart(2, "0")}.${String(n).padStart(3, "0")}Z`,
    newId: () => `id-${++n}`,
  };
}

/** A small stateful wrapper so tests read like the user's story. */
export class Scenario {
  book: Book = emptyBook();
  readonly clock = testClock();
  today = "2026-10-04";

  account(input: Partial<AccountInput> & Pick<AccountInput, "name" | "type">) {
    const r = addAccount(
      this.book,
      { openingBalanceMinor: 0, openedOn: "2026-01-01", ...input },
      this.clock,
    );
    if (!r.ok) throw new Error(r.issues.map((i) => i.message).join("; "));
    this.book = r.value.book;
    return r.value.account;
  }

  person(name: string) {
    const r = ensurePerson(this.book, name, this.clock)!;
    this.book = r.book;
    return r.person;
  }

  investment(name: string) {
    const r = ensureInvestment(this.book, name, "2026-01-01", this.clock)!;
    this.book = r.book;
    return r.account;
  }

  /** Records an event and returns the result so tests can also assert on rejections. */
  record(draft: EventDraft) {
    const r = addEvent(this.book, draft, this.clock);
    if (r.ok) this.book = r.value;
    return r;
  }

  /** Records an event that must be accepted. */
  ok(draft: EventDraft) {
    const r = this.record(draft);
    if (!r.ok) throw new Error(r.issues.map((i) => i.message).join("; "));
    return this.book.events[this.book.events.length - 1];
  }

  get ledger() {
    return buildLedger(this.book);
  }

  state(asOf = this.today) {
    return deriveState(this.book, this.ledger, asOf);
  }

  report(from = "2026-01-01", to = this.today) {
    return periodReport(this.book, this.ledger, from, to);
  }
}

/** The user's starting point in the spec: Assets ₹5,00,000, Liabilities ₹1,00,000, Net worth ₹4,00,000. */
export function startingScenario() {
  const s = new Scenario();
  const hdfc = s.account({ name: "HDFC", type: "bank", openingBalanceMinor: rs(500_000) });
  const loan = s.account({ name: "Home loan", type: "loan", openingBalanceMinor: rs(100_000) });
  return { s, hdfc, loan };
}
