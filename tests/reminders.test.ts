import { describe, expect, it } from "vitest";
import { isStopped, markPaid, nextDue } from "@/lib/finance/bills";
import { billDatesBetween } from "@/lib/finance/reminders";
import { stageOf, upcomingBills } from "@/lib/finance/reminders";
import type { RecurringCharge } from "@/lib/finance/recurring";
import type { Book } from "@/lib/finance/types";

const t = "2026-09-01T00:00:00Z";
const book: Book = {
  accounts: [
    { id: "Bank", name: "Bank", type: "bank", openingBalanceMinor: 0, openedOn: "2026-01-01", createdAt: t },
    { id: "Card", name: "HDFC Card", type: "credit_card", openingBalanceMinor: 0, openedOn: "2026-01-01", createdAt: t },
  ],
  people: [],
  events: [],
};
const bill = (statementDate: string, dueDate: string, totalDueMinor: number, minimumDueMinor?: number) => ({
  accountId: "Card",
  cardBill: { statementDate, dueDate, totalDueMinor, minimumDueMinor },
});
const sub = (key: string, nextDate: string): RecurringCharge =>
  ({ key, name: key, categoryId: "subscriptions", amountMinor: 19900, frequency: "monthly", kind: "subscription", lastDate: "2026-09-27", nextDate, occurrences: 3, monthlyEquivalentMinor: 19900 }) as RecurringCharge;

describe("upcomingBills", () => {
  it("lists an unpaid card bill inside the week, with what's left and its minimum", () => {
    const r = upcomingBills(book, [bill("2026-10-10", "2026-10-28", 500000, 25000)], [], "2026-10-25");
    expect(r).toEqual([expect.objectContaining({ kind: "card", title: "HDFC Card bill", days: 3, amountMinor: 500000, minimumMinor: 25000 })]);
  });

  it("leaves out bills far off, fully paid, or long overdue", () => {
    expect(upcomingBills(book, [bill("2026-10-10", "2026-11-20", 500000)], [], "2026-10-25")).toEqual([]);
    expect(upcomingBills(book, [bill("2026-08-10", "2026-08-28", 500000)], [], "2026-10-25")).toEqual([]);
    const paid: Book = {
      ...book,
      events: [{ id: "p", date: "2026-10-12", createdAt: t, updatedAt: t, type: "transfer", fromAccountId: "Bank", toAccountId: "Card", amountMinor: 500000 } as never],
    };
    expect(upcomingBills(paid, [bill("2026-10-10", "2026-10-28", 500000)], [], "2026-10-25")).toEqual([]);
  });

  it("keeps a just-missed bill, soonest first, and renewing subscriptions within three days", () => {
    const r = upcomingBills(book, [bill("2026-10-05", "2026-10-23", 100000)], [sub("Netflix", "2026-10-27"), sub("Later", "2026-11-05")], "2026-10-25");
    expect(r.map((x) => [x.title, x.days])).toEqual([
      ["HDFC Card bill", -2],
      ["Netflix", 2],
    ]);
  });
});

describe("stageOf", () => {
  it("steps up as a bill gets closer", () => {
    expect([5, 3, 2, 1, 0, -1].map(stageOf)).toEqual([0, 1, 1, 2, 2, 3]);
  });
});

describe("bills you add", () => {
  const rent = { id: "r", name: "Rent", dueDate: "2026-10-31", repeat: "monthly" as const, amountMinor: 2500000 };

  it("steps to the next date, clamping to short months", () => {
    expect(nextDue("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextDue("2026-10-05", "weekly")).toBe("2026-10-12");
    expect(nextDue("2028-02-29", "yearly")).toBe("2029-02-28");
  });

  it("marking paid moves a repeating bill past today, and finishes a one-off", () => {
    expect(markPaid(rent, "2026-10-25")?.dueDate).toBe("2026-11-30");
    expect(markPaid(markPaid(rent, "2026-10-25")!, "2026-11-30")?.dueDate).toBe("2026-12-31"); // keeps the 31st
    expect(markPaid({ ...rent, dueDate: "2026-08-31" }, "2026-10-25")?.dueDate).toBe("2026-10-31");
    expect(markPaid({ ...rent, repeat: "none" }, "2026-10-25")).toBeNull();
  });

  it("shows within a week, stays when overdue, and lists everything when asked", () => {
    const far = { id: "f", name: "Insurance", dueDate: "2027-03-01", repeat: "yearly" as const };
    const data = { bills: [rent, far, { id: "o", name: "Old", dueDate: "2026-10-01", repeat: "none" as const }], overrides: {} };
    expect(upcomingBills(book, [], [], "2026-10-25", { data }).map((r) => r.title)).toEqual(["Old", "Rent"]);
    expect(upcomingBills(book, [], [], "2026-10-25", { data, all: true }).map((r) => r.title)).toEqual(["Old", "Rent", "Insurance"]);
  });

  it("a moved card date replaces the printed one, until the next statement brings its own", () => {
    const b = bill("2026-10-10", "2026-10-28", 500000);
    const moved = { bills: [], overrides: { "card:Card": { from: "2026-10-28", to: "2026-10-30" } } };
    expect(upcomingBills(book, [b], [], "2026-10-25", { data: moved })[0]).toMatchObject({ dueDate: "2026-10-30", days: 5, moved: true, originalDate: "2026-10-28" });
    const next = bill("2026-11-10", "2026-11-28", 400000);
    expect(upcomingBills(book, [b, next], [], "2026-11-25", { data: moved })[0]).toMatchObject({ dueDate: "2026-11-28", moved: false });
  });
});

describe("billDatesBetween", () => {
  it("puts a repeating bill on every date it repeats to, keeping the 31st", () => {
    const rent = upcomingBills(book, [], [], "2026-10-25", { all: true, data: { bills: [{ id: "r", name: "Rent", dueDate: "2026-10-31", repeat: "monthly" }], overrides: {} } });
    const dates = [...billDatesBetween(rent, "2026-10-01", "2027-01-31").keys()];
    expect(dates).toEqual(["2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31"]);
  });

  it("puts a one-off bill on its date only, and nothing before it", () => {
    const once = upcomingBills(book, [], [], "2026-10-25", { all: true, data: { bills: [{ id: "o", name: "Tax", dueDate: "2026-11-15", repeat: "none" }], overrides: {} } });
    expect([...billDatesBetween(once, "2026-10-01", "2026-12-31").keys()]).toEqual(["2026-11-15"]);
    expect(billDatesBetween(once, "2026-12-01", "2026-12-31").size).toBe(0);
  });
});

describe("subscriptions you also added as a bill", () => {
  it("are listed once, as your bill", () => {
    const data = { bills: [{ id: "n", name: "Netflix", dueDate: "2026-10-27", repeat: "monthly" as const }], overrides: {} };
    const r = upcomingBills(book, [], [sub("Netflix", "2026-10-27"), sub("Spotify", "2026-10-27")], "2026-10-25", { data, all: true });
    expect(r.map((x) => [x.kind, x.title]).sort()).toEqual([["custom", "Netflix"], ["subscription", "Spotify"]]);
  });
});

describe("subscriptions marked not active", () => {
  const subs = [sub("Netflix", "2026-10-27"), sub("OneOff", "2026-10-26")]; // both last charged 2026-09-27
  const titles = (stopped: Record<string, { name: string; lastDate: string }>, list = subs) =>
    upcomingBills(book, [], list, "2026-10-25", { data: { bills: [], overrides: {}, stopped }, all: true }).map((r) => r.title);

  it("are left out of reminders and the calendar", () => {
    expect(titles({})).toEqual(["OneOff", "Netflix"]);
    expect(titles({ "sub:OneOff": { name: "OneOff", lastDate: "2026-09-27" } })).toEqual(["Netflix"]);
  });

  it("come back on their own when they charge again after being stopped", () => {
    const stopped = { "sub:OneOff": { name: "OneOff", lastDate: "2026-09-27" } };
    const charged = [sub("Netflix", "2026-10-27"), { ...sub("OneOff", "2026-11-26"), lastDate: "2026-10-26" }];
    expect(titles(stopped, charged)).toEqual(["Netflix", "OneOff"]);
    expect(isStopped(stopped, "sub:OneOff", "2026-10-26")).toBe(false);
    expect(isStopped(stopped, "sub:OneOff", "2026-09-27")).toBe(true);
  });
});
