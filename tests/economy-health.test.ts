import { describe, expect, it } from "vitest";
import { parseReserves, rankBySize } from "@/lib/market/economy";
import { indicators, ordinal, reservesVerdict, tally } from "@/lib/market/health";
import type { Economy, YearValue } from "@/lib/market/types";

/** 2023–2025 actual, 2026 the IMF's estimate. */
const run = (a: number, b: number, c: number, est: number): YearValue[] => [
  { year: 2023, value: a, forecast: false },
  { year: 2024, value: b, forecast: false },
  { year: 2025, value: c, forecast: false },
  { year: 2026, value: est, forecast: true },
];

function economy(over: Partial<Economy> = {}): Economy {
  return {
    code: "IND",
    name: "India",
    group: "emerging",
    gdpGrowth: run(9.2, 6.5, 7.6, 6.5),
    inflation: run(5.4, 4.6, 2.1, 4.7),
    // As the IMF has it for India: real figures until 2022, then 4.9% carried forward, forecasts included.
    unemployment: [{ year: 2022, value: 4.1, forecast: false }, ...run(4.9, 4.9, 4.9, 4.9)],
    debt: run(85, 84.8, 84.1, 83.4),
    currentAccount: run(-0.7, -0.6, -0.9, -2.0),
    fiscalBalance: run(-8.4, -7.9, -7.4, -7.4),
    gdpPerCapita: run(2434, 2592, 2675, 2813),
    gdpSize: run(3600, 3760, 3916, 4153),
    policy: null,
    reserves: { year: 2025, months: 7.9 },
    sizeRank: 6,
    ...over,
  };
}

const byKey = (e: Economy) => Object.fromEntries(indicators(e).map((i) => [i.key, i]));

describe("economy indicators", () => {
  it("judges the latest actual year, never the IMF's estimate", () => {
    const c = byKey(economy());
    // 2025 actual growth 7.6% (healthy), better than 2024's 6.5%; the 2026 estimate is kept apart.
    expect(c.growth).toMatchObject({ verdict: "good", trend: "better", latest: { year: 2025, value: 7.6 }, outlook: { year: 2026, value: 6.5 } });
    // 2025 inflation 2.1%: inside the RBI's 2–6% band (the 2026 estimate of 4.7% doesn't decide it).
    expect(c.inflation).toMatchObject({ verdict: "good", latest: { value: 2.1 }, rule: "Healthy: 2–6% (the RBI's target band)", target: 4, trend: "worse" });
    expect(c.deficit).toMatchObject({ verdict: "weak", trend: "better" });
    expect(c.debt).toMatchObject({ verdict: "watch" });
    expect(c.external).toMatchObject({ verdict: "good", trend: "worse" });
    expect(c.income).toMatchObject({ verdict: null, trend: "better" });
  });

  it("tells a real run of similar years from one figure carried forward", () => {
    const real = byKey(economy({ unemployment: run(5.1, 4.9, 4.8, 4.8) })).jobs;
    expect(real.verdict).toBe("good");
  });

  it("doesn't judge a figure the source just repeats", () => {
    const jobs = byKey(economy()).jobs;
    expect(jobs.verdict).toBeNull();
    expect(jobs.trend).toBeNull();
    expect(jobs.caveat).toBe("The source repeats 4.9% every year: no fresh figure to judge");
    expect(jobs.repeatedFrom).toBe(2023);
  });

  it("holds mature economies to their own ranges, and doesn't judge their reserves", () => {
    const us = economy({ code: "USA", group: "advanced", gdpGrowth: run(2.9, 2.8, 2.1, 2.3), inflation: run(4.1, 3.0, 2.7, 3.2), debt: run(120, 122, 124, 126), reserves: { year: 2025, months: 2.8 } });
    const c = byKey(us);
    expect(c.growth.verdict).toBe("good");
    expect(c.inflation.verdict).toBe("good");
    expect(c.debt.verdict).toBe("weak");
    expect(reservesVerdict(us)).toBeNull();
  });

  it("flags shrinking output and falling prices", () => {
    const c = byKey(economy({ gdpGrowth: run(2, 1, -1.2, 0.5), inflation: run(1, 0.5, -0.5, 0.2) }));
    expect(c.growth.verdict).toBe("weak");
    expect(c.inflation.verdict).toBe("weak");
  });

  it("counts verdicts for the latest actual year, reserves included", () => {
    const e = economy();
    expect(tally(e, indicators(e))).toEqual({ counts: { good: 4, watch: 1, weak: 1 }, year: 2025 });
  });

  it("leaves out what isn't there (an answer saved by an older version)", () => {
    const old = { code: "IND", name: "India", gdpGrowth: run(9.2, 6.5, 7.6, 6.5), inflation: run(5.4, 4.6, 2.1, 4.7), unemployment: [], debt: [], currentAccount: [], policy: null } as unknown as Economy;
    expect(indicators(old).map((i) => i.key)).toEqual(["growth", "inflation"]);
  });

  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "103rd"]);
  });
});

describe("economy sources", () => {
  it("ranks by GDP among countries only, not groups", () => {
    const json = { values: { NGDPD: { USA: { "2025": 30000 }, WEOWORLD: { "2025": 118000 }, EURO: { "2025": 18000 }, CHN: { "2025": 19600 }, IND: { "2025": 3916 }, DEU: { "2025": 4800 }, "": null } } };
    const ranks = rankBySize(json, new Set(["USA", "CHN", "IND", "DEU"]), ["IND", "USA", "WEOWORLD"], 2025);
    expect(ranks).toEqual({ USA: 1, IND: 4 });
  });

  it("reads the World Bank's reserves, latest year each", () => {
    const json = [
      { page: 1 },
      [
        { countryiso3code: "IND", date: "2025", value: 7.9 },
        { countryiso3code: "USA", date: "2025", value: null },
        { countryiso3code: "USA", date: "2024", value: 2.8 },
      ],
    ];
    expect(parseReserves(json)).toEqual({ IND: { year: 2025, months: 7.9 }, USA: { year: 2024, months: 2.8 } });
  });
});
