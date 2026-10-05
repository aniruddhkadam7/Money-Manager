import { describe, expect, it } from "vitest";
import { formatBps, formatCompactINR, formatExactINR, formatHeadlineINR, formatSignedINR } from "@/lib/charts/format";
import { monotonePath } from "@/lib/charts/path";
import { nearestIndex, niceTicks, spreadIndexes } from "@/lib/charts/scale";
import { buildInsights } from "@/lib/finance/insights";
import { incomeSources } from "@/lib/finance/sources";
import { detectRecurring, fixedCommitmentsMinor, upcomingCharges } from "@/lib/finance/recurring";
import {
  balanceSeries, changeBps, firstActivityDate, healthMetrics, monthlySummaries, moneyFlow, rangeStart, sampleDates,
} from "@/lib/finance/series";
import { deriveState } from "@/lib/finance/state";
import { rs, Scenario, startingScenario } from "./helpers";

const TODAY = "2026-10-04";

describe("chart formatting", () => {
  it("formats Indian compact amounts", () => {
    expect(formatCompactINR(rs(850))).toBe("₹850");
    expect(formatCompactINR(rs(52_000))).toBe("₹52K");
    expect(formatCompactINR(rs(120_000))).toBe("₹1.2L");
    expect(formatCompactINR(rs(1_840_000))).toBe("₹18.4L");
    expect(formatCompactINR(rs(21_500_000))).toBe("₹2.15Cr");
    expect(formatCompactINR(-rs(1_000_000))).toBe("−₹10L");
  });
  it("headline is always exact, never shortened to L / Cr", () => {
    expect(formatHeadlineINR(rs(64_200))).toBe("₹64,200");
    expect(formatHeadlineINR(rs(114_800))).toBe("₹1,14,800");
    expect(formatHeadlineINR(rs(1_840_000))).toBe("₹18,40,000");
  });
  it("exact, signed and percent", () => {
    expect(formatExactINR(rs(1_842_500))).toBe("₹18,42,500");
    expect(formatSignedINR(rs(42_500))).toBe("+₹42,500");
    expect(formatSignedINR(-rs(1_200))).toBe("−₹1,200");
    expect(formatSignedINR(0)).toBe("₹0");
    expect(formatBps(4630)).toBe("46%");
    expect(formatBps(4630, 1)).toBe("46.3%");
  });
});

describe("chart maths", () => {
  it("nice ticks are round and within range", () => {
    const t = niceTicks(0, 1_840_000, 4);
    expect(t[0]).toBeGreaterThanOrEqual(0);
    expect(t[t.length - 1]).toBeLessThanOrEqual(1_840_000);
    expect(t.length).toBeGreaterThanOrEqual(3);
    const step = t[1] - t[0];
    expect(t.every((v, i) => i === 0 || Math.abs(v - t[i - 1] - step) < 1e-6)).toBe(true);
    expect(niceTicks(5, 5)).toEqual([5]);
  });

  it("nearestIndex picks the closest x", () => {
    const xs = [0, 10, 20, 40];
    expect(nearestIndex(xs, -5)).toBe(0);
    expect(nearestIndex(xs, 14)).toBe(1);
    expect(nearestIndex(xs, 16)).toBe(2);
    expect(nearestIndex(xs, 31)).toBe(3);
    expect(nearestIndex(xs, 999)).toBe(3);
  });

  it("spreadIndexes includes both ends", () => {
    expect(spreadIndexes(100, 5)).toEqual([0, 25, 50, 74, 99]);
    expect(spreadIndexes(3, 5)).toEqual([0, 1, 2]);
  });

  it("monotone curve never overshoots the data", () => {
    const ys = [10, 10, 40, 41, 41, 90, 20];
    const pts = ys.map((y, i) => ({ x: i * 10, y }));
    const path = monotonePath(pts);
    expect(path.startsWith("M0,10")).toBe(true);
    expect((path.match(/C/g) ?? []).length).toBe(pts.length - 1);
    // every control point's y stays between its segment's endpoints
    const nums = path.split("C").slice(1).map((seg) => seg.split(",").map(Number));
    nums.forEach(([, c1y, , c2y], i) => {
      const lo = Math.min(ys[i], ys[i + 1]);
      const hi = Math.max(ys[i], ys[i + 1]);
      expect(c1y).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(c1y).toBeLessThanOrEqual(hi + 1e-6);
      expect(c2y).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(c2y).toBeLessThanOrEqual(hi + 1e-6);
    });
    expect(monotonePath([])).toBe("");
    expect(monotonePath([{ x: 1, y: 2 }])).toBe("M1,2");
  });
});

describe("date sampling and ranges", () => {
  it("samples ascending dates that end exactly on the end date", () => {
    const d = sampleDates("2026-01-01", "2026-10-04", 90);
    expect(d[0]).toBe("2026-01-01");
    expect(d[d.length - 1]).toBe("2026-10-04");
    expect(d.length).toBeLessThanOrEqual(91);
    expect([...d].sort()).toEqual(d);
    expect(new Set(d).size).toBe(d.length);
    expect(sampleDates("2026-10-04", "2026-10-04")).toEqual(["2026-10-04"]);
    expect(sampleDates("2026-10-01", "2026-10-04")).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  });

  it("range starts: fixed windows, and All begins at the first real activity", () => {
    expect(rangeStart("1M", TODAY, null)).toBe("2026-09-04");
    expect(rangeStart("1Y", TODAY, null)).toBe("2025-10-04");
    expect(rangeStart("ALL", TODAY, "2026-03-15")).toBe("2026-03-15");
    expect(rangeStart("ALL", TODAY, "2026-10-03")).toBe("2026-09-27"); // never less than a week
    expect(rangeStart("ALL", TODAY, null)).toBe("2026-09-27");
  });
});

/** Six months of a realistic life. */
function realisticYear() {
  const { s, hdfc } = startingScenario();
  const fund = s.investment("Index fund");
  const rahul = s.person("Rahul");
  const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  months.forEach((ym, i) => {
    s.ok({ type: "income", date: `${ym}-01`, accountId: hdfc.id, amountMinor: rs(100_000), categoryId: "salary" });
    s.ok({ type: "expense", date: `${ym}-02`, accountId: hdfc.id, amountMinor: rs(18_000), categoryId: "rent", description: "Rent" });
    s.ok({ type: "expense", date: `${ym}-03`, accountId: hdfc.id, amountMinor: rs(649), categoryId: "entertainment", description: "Netflix" });
    s.ok({ type: "expense", date: `${ym}-03`, accountId: hdfc.id, amountMinor: rs(8_000 + i * 1_000), categoryId: "food", description: "Groceries and food" });
    if (ym !== "2026-10") s.ok({ type: "invest", date: `${ym}-10`, fromAccountId: hdfc.id, holdingId: fund.id, amountMinor: rs(10_000) });
    if (ym !== "2026-10") s.ok({ type: "update_valuation", date: `${ym}-25`, holdingId: fund.id, valueMinor: rs(10_000 * (i + 1) + 500 * (i + 1) * (i + 1)) });
  });
  s.ok({ type: "lend", date: "2026-09-15", personId: rahul.id, accountId: hdfc.id, amountMinor: rs(5_000) });
  return { s, hdfc, fund, rahul };
}

describe("balance series", () => {
  it("every point equals the balance sheet derived directly for that date", () => {
    const { s } = realisticYear();
    const dates = sampleDates("2026-05-01", TODAY, 60);
    const series = balanceSeries(s.book, s.ledger, dates);
    expect(series).toHaveLength(dates.length);
    for (const p of series) {
      const st = deriveState(s.book, s.ledger, p.date);
      expect(p.netWorthMinor, `net worth ${p.date}`).toBe(st.netWorthMinor);
      expect(p.assetsMinor, `assets ${p.date}`).toBe(st.assets.totalMinor);
      expect(p.liabilitiesMinor, `liabilities ${p.date}`).toBe(st.liabilities.totalMinor);
      expect(p.investmentsMinor, `investments ${p.date}`).toBe(st.investments.valueMinor);
      expect(p.investedMinor, `invested ${p.date}`).toBe(st.investments.costBasisMinor);
      expect(p.netWorthMinor).toBe(p.assetsMinor - p.liabilitiesMinor);
    }
  });

  it("is flat before anything happens and handles an empty book", () => {
    const empty = new Scenario();
    const series = balanceSeries(empty.book, empty.ledger, ["2026-09-01", TODAY]);
    expect(series.every((p) => p.netWorthMinor === 0)).toBe(true);
    expect(firstActivityDate(empty.ledger)).toBeNull();
  });

  it("first activity ignores opening balances", () => {
    const { s } = realisticYear();
    expect(firstActivityDate(s.ledger)).toBe("2026-05-01");
  });
});

describe("monthly summaries", () => {
  it("matches the period report, counts only real investing, and compares like with like", () => {
    const { s } = realisticYear();
    const months = monthlySummaries(s.book, s.ledger, "2026-10", 6, TODAY);
    expect(months.map((m) => m.ym)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);

    const sept = months[4];
    expect(sept.incomeMinor).toBe(rs(100_000));
    expect(sept.expensesMinor).toBe(rs(18_000 + 649 + 12_000));
    expect(sept.savingsMinor).toBe(sept.incomeMinor - sept.expensesMinor);
    expect(sept.investedMinor).toBe(rs(10_000));
    expect(sept.partial).toBe(false);
    expect(sept.byCategory[0].categoryId).toBe("rent");
    expect(sept.comparableExpensesMinor).toBe(months[3].expensesMinor); // vs full August

    const oct = months[5];
    expect(oct.partial).toBe(true);
    expect(oct.investedMinor).toBe(0);
    // the month in progress is compared with September up to the 4th: rent(2nd)+Netflix(3rd)+food(3rd)
    expect(oct.comparableExpensesMinor).toBe(rs(18_000 + 649 + 12_000));
  });

  it("changeBps handles missing baselines", () => {
    expect(changeBps(6140, 5800)).toBe(586);
    expect(changeBps(100, 0)).toBeNull();
    expect(changeBps(100, null)).toBeNull();
    expect(changeBps(50, 100)).toBe(-5000);
  });
});

describe("money flow", () => {
  it("splits income into spent, invested and saved", () => {
    const { s } = realisticYear();
    const sept = monthlySummaries(s.book, s.ledger, "2026-10", 6, TODAY)[4];
    const flow = moneyFlow(sept);
    expect(flow.spentMinor + flow.investedMinor + flow.savedMinor).toBe(flow.incomeMinor);
    expect(flow.fromSavingsMinor).toBe(0);
  });

  it("reports a shortfall instead of a negative saving", () => {
    const { s, hdfc } = startingScenario();
    s.ok({ type: "income", date: "2026-10-01", accountId: hdfc.id, amountMinor: rs(10_000), categoryId: "salary" });
    s.ok({ type: "expense", date: "2026-10-02", accountId: hdfc.id, amountMinor: rs(15_000), categoryId: "food", description: "Big month" });
    const oct = monthlySummaries(s.book, s.ledger, "2026-10", 1, TODAY)[0];
    const flow = moneyFlow(oct);
    expect(flow.savedMinor).toBe(0);
    expect(flow.fromSavingsMinor).toBe(rs(5_000));
  });
});

describe("recurring commitments", () => {
  it("finds steady monthly charges and their next date", () => {
    const { s } = realisticYear();
    const found = detectRecurring(s.book, s.ledger, TODAY);
    const names = found.map((c) => c.name);
    expect(names).toContain("Rent");
    expect(names).toContain("Netflix");
    const rent = found.find((c) => c.name === "Rent")!;
    expect(rent.frequency).toBe("monthly");
    expect(rent.amountMinor).toBe(rs(18_000));
    expect(rent.lastDate).toBe("2026-10-02");
    expect(rent.nextDate).toBe("2026-11-02");
    expect(rent.occurrences).toBe(6);
    expect(fixedCommitmentsMinor(found)).toBeGreaterThanOrEqual(rs(18_000 + 649));
  });

  it("ignores irregular or erratic spending and one-offs", () => {
    const { s, hdfc } = startingScenario();
    for (const d of ["2026-06-02", "2026-06-20", "2026-08-01", "2026-09-30"]) {
      s.ok({ type: "expense", date: d, accountId: hdfc.id, amountMinor: rs(500), categoryId: "food", description: "Random cafe" });
    }
    s.ok({ type: "expense", date: "2026-09-01", accountId: hdfc.id, amountMinor: rs(9_000), categoryId: "shopping", description: "One-off" });
    expect(detectRecurring(s.book, s.ledger, TODAY)).toEqual([]);
  });

  it("ignores monthly charges whose amount swings wildly, and ones that stopped", () => {
    const { s, hdfc } = startingScenario();
    [["2026-07-05", 500], ["2026-08-05", 5_000], ["2026-09-05", 800]].forEach(([d, a]) =>
      s.ok({ type: "expense", date: d as string, accountId: hdfc.id, amountMinor: rs(a as number), categoryId: "bills", description: "Electricity" }),
    );
    ["2026-02-10", "2026-03-10", "2026-04-10"].forEach((d) =>
      s.ok({ type: "expense", date: d, accountId: hdfc.id, amountMinor: rs(300), categoryId: "bills", description: "Old gym" }),
    );
    expect(detectRecurring(s.book, s.ledger, TODAY)).toEqual([]);
  });

  it("detects weekly charges and clamps month-end dates", () => {
    const { s, hdfc } = startingScenario();
    ["2026-09-13", "2026-09-20", "2026-09-27", "2026-10-04"].forEach((d) =>
      s.ok({ type: "expense", date: d, accountId: hdfc.id, amountMinor: rs(700), categoryId: "food", description: "Weekly milk" }),
    );
    ["2026-07-31", "2026-08-31", "2026-09-30"].forEach((d) =>
      s.ok({ type: "expense", date: d, accountId: hdfc.id, amountMinor: rs(1_200), categoryId: "bills", description: "Internet" }),
    );
    const found = detectRecurring(s.book, s.ledger, TODAY);
    const weekly = found.find((c) => c.name === "Weekly milk")!;
    expect(weekly.frequency).toBe("weekly");
    expect(weekly.nextDate).toBe("2026-10-11");
    expect(weekly.monthlyEquivalentMinor).toBe(Math.round((rs(700) * 52) / 12));
    expect(found.find((c) => c.name === "Internet")!.nextDate).toBe("2026-10-30");
  });

  it("upcoming picks charges due soon", () => {
    const { s } = realisticYear();
    const found = detectRecurring(s.book, s.ledger, TODAY);
    const soon = upcomingCharges(found, TODAY, 30).map((c) => c.name);
    expect(soon).toContain("Rent"); // due 2026-11-02, 29 days away
    expect(upcomingCharges(found, TODAY, 10)).toEqual([]);
  });
});

describe("financial health", () => {
  it("computes rates in basis points and tolerates missing income", () => {
    const { s } = realisticYear();
    const months = monthlySummaries(s.book, s.ledger, "2026-10", 6, TODAY);
    const sept = months[4];
    const st = s.state(TODAY);
    const h = healthMetrics(sept, st, rs(18_649));
    expect(h.savingsRateBps).toBe(Math.round(((sept.incomeMinor - sept.expensesMinor) / sept.incomeMinor) * 10_000));
    expect(h.investmentRateBps).toBe(1000);
    expect(h.commitmentsShareBps).toBe(1865);
    expect(h.debtToAssetBps).toBe(Math.round((st.liabilities.totalMinor / st.assets.totalMinor) * 10_000));

    const none = new Scenario();
    const m = monthlySummaries(none.book, none.ledger, "2026-10", 1, TODAY)[0];
    const empty = healthMetrics(m, none.state(), 0);
    expect(empty.savingsRateBps).toBeNull();
    expect(empty.debtToAssetBps).toBeNull();
  });
});

describe("insights", () => {
  it("writes sentences from computed numbers only", () => {
    const { s } = realisticYear();
    const months = monthlySummaries(s.book, s.ledger, "2026-10", 6, TODAY);
    const st = s.state(TODAY);
    const found = detectRecurring(s.book, s.ledger, TODAY);
    const insights = buildInsights({
      months,
      categoryName: (id) => id[0].toUpperCase() + id.slice(1),
      netWorthChangeMinor: rs(42_500),
      people: st.people,
      upcoming: upcomingCharges(found, TODAY, 40),
      health: healthMetrics(months[5], st, fixedCommitmentsMinor(found)),
      today: TODAY,
    });
    const text = insights.map((i) => i.text).join("\n");
    expect(insights.length).toBeGreaterThan(0);
    expect(insights.length).toBeLessThanOrEqual(5);
    expect(text).toContain("₹42,500");
    expect(text).toContain("Rahul owes you ₹5,000");
    expect(text).toMatch(/Rent is your biggest expense this month/);
    expect(insights.find((i) => i.id === "net-worth")!.tone).toBe("positive");
  });

  it("stays quiet when there is nothing to say", () => {
    const s = new Scenario();
    const months = monthlySummaries(s.book, s.ledger, "2026-10", 2, TODAY);
    expect(
      buildInsights({
        months, categoryName: (id) => id, netWorthChangeMinor: 0, people: [], upcoming: [],
        health: healthMetrics(months[1], s.state(), 0), today: TODAY,
      }),
    ).toEqual([]);
  });
});

describe("income sources", () => {
  const name = (id: string) => ({ salary: "Salary", interest: "Interest", gift: "Gift" } as Record<string, string>)[id] ?? id;

  it("groups by payer (case-insensitively), falls back to category, largest first", () => {
    const { s, hdfc } = startingScenario();
    s.ok({ type: "income", date: "2026-08-01", accountId: hdfc.id, amountMinor: rs(100_000), categoryId: "salary", description: "Acme Pvt Ltd" });
    s.ok({ type: "income", date: "2026-09-01", accountId: hdfc.id, amountMinor: rs(100_000), categoryId: "salary", description: "acme pvt ltd" });
    s.ok({ type: "income", date: "2026-09-10", accountId: hdfc.id, amountMinor: rs(12_000), categoryId: "interest" });
    s.ok({ type: "income", date: "2026-09-15", accountId: hdfc.id, amountMinor: rs(3_000), categoryId: "gift", description: "Aunt" });

    const sources = incomeSources(s.book, s.ledger, "2026-01-01", "2026-12-31", name);
    expect(sources.map((x) => x.name)).toEqual(["Acme Pvt Ltd", "Interest", "Aunt"]);
    expect(sources[0]).toMatchObject({ amountMinor: rs(200_000), count: 2, lastDate: "2026-09-01", categoryId: "salary" });
  });

  it("respects the date range and never counts loans, repayments or sales as income", () => {
    const { s, hdfc } = startingScenario();
    const rahul = s.person("Rahul");
    const fund = s.investment("Fund");
    s.ok({ type: "income", date: "2026-03-01", accountId: hdfc.id, amountMinor: rs(50_000), categoryId: "salary", description: "Old job" });
    s.ok({ type: "income", date: "2026-09-01", accountId: hdfc.id, amountMinor: rs(90_000), categoryId: "salary", description: "New job" });
    s.ok({ type: "borrow", date: "2026-09-02", personId: rahul.id, accountId: hdfc.id, amountMinor: rs(20_000) });
    s.ok({ type: "invest", date: "2026-09-03", fromAccountId: hdfc.id, holdingId: fund.id, amountMinor: rs(10_000) });
    s.ok({ type: "sell_investment", date: "2026-09-20", holdingId: fund.id, toAccountId: hdfc.id, proceedsMinor: rs(12_000) });

    const recent = incomeSources(s.book, s.ledger, "2026-07-01", "2026-12-31", name);
    expect(recent.map((x) => x.name)).toEqual(["New job"]);
    expect(incomeSources(s.book, s.ledger, "2026-01-01", "2026-02-28", name)).toEqual([]);
  });
});
