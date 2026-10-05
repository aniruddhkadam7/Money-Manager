import { describe, expect, it } from "vitest";
import { buildLedger } from "@/lib/finance/engine";
import { detectRecurring, subscriptionsOf } from "@/lib/finance/recurring";
import { rs, startingScenario } from "./helpers";

const run = (events: { date: string; description: string; amount: number; category?: string }[], today = "2026-10-20") => {
  const { s, hdfc } = startingScenario();
  for (const e of events) s.ok({ type: "expense", date: e.date, description: e.description, accountId: hdfc.id, amountMinor: rs(e.amount), categoryId: e.category ?? "entertainment" });
  return detectRecurring(s.book, buildLedger(s.book), today);
};

describe("recurring payments and subscriptions", () => {
  it("recognises a subscription even when the bank narration changes each month", () => {
    const found = run([
      { date: "2026-08-10", description: "NETFLIX.COM MUMBAI", amount: 649 },
      { date: "2026-09-10", description: "Netflix", amount: 649 },
      { date: "2026-10-10", description: "UPI-NETFLIX-640811112222", amount: 649 },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: "Netflix", kind: "subscription", frequency: "monthly", amountMinor: rs(649), occurrences: 3 });
    expect(found[0].nextDate).toBe("2026-11-10");
  });

  it("spots a known subscription after only two months, but not an unknown merchant", () => {
    const found = run([
      { date: "2026-09-05", description: "Spotify", amount: 119 },
      { date: "2026-10-05", description: "Spotify", amount: 119 },
      { date: "2026-09-07", description: "Corner Cafe", amount: 200, category: "food" },
      { date: "2026-10-07", description: "Corner Cafe", amount: 200, category: "food" },
    ]);
    expect(found.map((c) => c.name)).toEqual(["Spotify"]);
  });

  it("follows a price rise, and reports the latest price", () => {
    const found = run([
      { date: "2026-07-12", description: "Netflix", amount: 499 },
      { date: "2026-08-12", description: "Netflix", amount: 499 },
      { date: "2026-09-12", description: "Netflix", amount: 649 },
      { date: "2026-10-12", description: "Netflix", amount: 649 },
    ]);
    expect(found[0].amountMinor).toBe(rs(649));
  });

  it("separates subscriptions from other repeating payments like rent", () => {
    const found = run([
      { date: "2026-08-01", description: "Rent", amount: 18000, category: "rent" },
      { date: "2026-09-01", description: "Rent", amount: 18000, category: "rent" },
      { date: "2026-10-01", description: "Rent", amount: 18000, category: "rent" },
      { date: "2026-08-15", description: "Airtel postpaid", amount: 399, category: "bills" },
      { date: "2026-09-15", description: "Airtel postpaid", amount: 399, category: "bills" },
      { date: "2026-10-15", description: "Airtel postpaid", amount: 399, category: "bills" },
    ]);
    expect(found).toHaveLength(2);
    expect(found.find((c) => c.name === "Rent")!.kind).toBe("recurring");
    expect(subscriptionsOf(found).map((c) => c.name)).toEqual(["Airtel"]);
  });

  it("drops a subscription that stopped months ago", () => {
    expect(
      run([
        { date: "2026-02-10", description: "Netflix", amount: 649 },
        { date: "2026-03-10", description: "Netflix", amount: 649 },
        { date: "2026-04-10", description: "Netflix", amount: 649 },
      ]),
    ).toHaveLength(0);
  });
});

describe("the Subscriptions category", () => {
  it("counts an unknown service filed under Subscriptions", () => {
    const found = run([
      { date: "2026-09-04", description: "Local Gym Club", amount: 800, category: "subscriptions" },
      { date: "2026-10-04", description: "Local Gym Club", amount: 800, category: "subscriptions" },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("subscription");
  });
});

describe("things the person filed under Subscriptions", () => {
  it("shows even a single payment, with the rhythm marked as assumed", () => {
    const found = run([{ date: "2026-10-03", description: "LinkedIn Premium", amount: 1999, category: "subscriptions" }]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: "LinkedIn", kind: "subscription", frequency: "monthly", assumed: true, amountMinor: rs(1999) });
    expect(found[0].nextDate).toBe("2026-11-03");
  });

  it("shows prepaid recharges of changing size and rhythm", () => {
    const found = run([
      { date: "2026-07-01", description: "Airtel recharge", amount: 299, category: "subscriptions" },
      { date: "2026-08-15", description: "Airtel recharge", amount: 719, category: "subscriptions" },
      { date: "2026-10-12", description: "Airtel recharge", amount: 299, category: "subscriptions" },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: "Airtel", kind: "subscription", amountMinor: rs(299) });
  });

  it("still drops one that clearly stopped long ago", () => {
    expect(run([{ date: "2026-03-03", description: "LinkedIn Premium", amount: 1999, category: "subscriptions" }])).toHaveLength(0);
  });
});

describe("patterns seen in a real bank statement", () => {
  it("catches Apple Media billed twice, 30 days apart", () => {
    const found = run([
      { date: "2026-09-05", description: "Apple Media Services", amount: 1999 },
      { date: "2026-10-04", description: "Apple Media Services", amount: 1999 },
    ]);
    expect(found.map((c) => [c.name, c.kind])).toEqual([["Apple", "subscription"]]);
  });

  it("allows a 25-day gap between monthly bills", () => {
    const found = run([
      { date: "2026-08-11", description: "Airtel", amount: 449 },
      { date: "2026-09-05", description: "Airtel", amount: 449 },
      { date: "2026-10-05", description: "Airtel", amount: 449 },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: "Airtel", frequency: "monthly" });
  });

  it("does not treat card-bill payments to CRED as a subscription", () => {
    expect(
      run([
        { date: "2026-09-11", description: "Dreamplug Serv", amount: 399, category: "bills" },
        { date: "2026-10-11", description: "Dreamplug Serv", amount: 399, category: "bills" },
      ]).filter((c) => c.kind === "subscription"),
    ).toEqual([]);
  });
});

describe("merchants nobody listed, detected automatically", () => {
  it("treats the same amount leaving every month as a subscription (the EarlySalary / Razorpay pattern)", () => {
    const found = run(
      ["2026-06-05", "2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"].map((date) => ({ date, description: "Razorpay", amount: 6468, category: "other" })),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: "Razorpay", kind: "subscription", via: "pattern", frequency: "monthly", amountMinor: rs(6468) });
  });

  it("does not call rent, or a payment of changing size, a subscription", () => {
    const rent = run(["2026-08-01", "2026-09-01", "2026-10-01"].map((date) => ({ date, description: "Amit Kumar", amount: 18000, category: "rent" })));
    expect(rent.map((c) => c.kind)).toEqual(["recurring"]);
    const varying = run([
      { date: "2026-08-08", description: "Local Mess", amount: 2800, category: "food" },
      { date: "2026-09-08", description: "Local Mess", amount: 3100, category: "food" },
      { date: "2026-10-08", description: "Local Mess", amount: 2650, category: "food" },
    ]);
    expect(varying.filter((c) => c.kind === "subscription")).toEqual([]);
  });

  it("recognises an auto-debit mandate from the bank's own wording, after just two payments", () => {
    const { s, hdfc } = startingScenario();
    for (const date of ["2026-09-12", "2026-10-12"]) {
      s.ok({
        type: "expense", date, description: "Acme Cloud", accountId: hdfc.id, amountMinor: rs(499), categoryId: "bills",
        sources: [{ kind: "statement", importId: "i", rowId: date, filename: "x.pdf", line: 1, role: "created", narration: "ACH D- ACME CLOUD LTD-0012345" }],
      });
    }
    const found = detectRecurring(s.book, buildLedger(s.book), "2026-10-20");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "subscription", via: "autopay", frequency: "monthly" });
  });
});

describe("what a real year of statements looked like", () => {
  it("keeps Apple's ₹1,999 plan apart from a ₹79 one-off, and never calls a monthly payment to a person a subscription", () => {
    const apple = run([
      { date: "2026-08-05", description: "Apple Media Services", amount: 1999 },
      { date: "2026-09-04", description: "Apple Media Services", amount: 1999 },
      { date: "2026-09-17", description: "Apple Media Services", amount: 79 },
    ]);
    const plan = apple.find((c) => c.amountMinor === rs(1999));
    expect(plan).toMatchObject({ kind: "subscription", occurrences: 2 });
    expect(apple.find((c) => c.amountMinor === rs(79))).toBeUndefined(); // a single ₹79 purchase is not recurring

    const person = run(["2026-07-03", "2026-08-03", "2026-09-04"].map((date) => ({ date, description: "Vicky Subhash", amount: 12000, category: "other" })));
    expect(person.filter((c) => c.kind === "subscription")).toEqual([]);
  });

  it("joins one loan's payments split across truncated names and a one-off higher month", () => {
    const found = run([
      { date: "2026-06-05", description: "Razorpay", amount: 6468, category: "other" },
      { date: "2026-07-05", description: "Razorpay Pv", amount: 6468, category: "other" },
      { date: "2026-08-04", description: "Razorpay Pv", amount: 7478, category: "other" },
      { date: "2026-09-05", description: "Razorpay Pv", amount: 6468, category: "other" },
      { date: "2026-10-05", description: "Razorpay Pv", amount: 6468, category: "other" },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "subscription", via: "pattern", occurrences: 5 });
  });
});

describe("known services count on their name alone", () => {
  it("shows GitHub with irregular dates and amounts", () => {
    const found = run([
      { date: "2026-07-16", description: "GitHub", amount: 940.31, category: "other" },
      { date: "2026-08-30", description: "GitHub", amount: 955.47, category: "other" },
      { date: "2026-09-02", description: "GitHub", amount: 955.47, category: "other" },
      { date: "2026-10-09", description: "GitHub", amount: 1204.1, category: "other" },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: "GitHub", kind: "subscription" });
  });

  it("shows a known service after a single payment, labelled as assumed", () => {
    const found = run([{ date: "2026-10-03", description: "Netflix", amount: 199, category: "other" }]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: "Netflix", assumed: true, amountMinor: rs(199) });
  });

  it("still ignores a known service that stopped long ago, and ambiguous stores on a single purchase", () => {
    expect(run([{ date: "2026-03-14", description: "Netflix", amount: 199, category: "other" }])).toEqual([]);
    expect(run([{ date: "2026-10-03", description: "Apple Store", amount: 79, category: "other" }])).toEqual([]);
  });
});
