import { describe, expect, it } from "vitest";
import { parseConstituents } from "@/lib/market/constituents";
import { formatCrore, formatPct } from "@/lib/market/format";
import { dropOldMarketStorage } from "@/lib/market/old-storage";
import { indexQuote, member } from "@/lib/market/service";
import type { Member } from "@/lib/market/types";
import { groupPe, sectorWeights } from "@/lib/market/weights";
import { parseQuotes, parseRatios } from "@/lib/market/yahoo";

const m = (symbol: string, industry: string, marketCap: number | null, changePct: number | null = 0): Member => ({
  symbol,
  name: symbol,
  industry,
  price: 100,
  changePct,
  marketCap,
  pe: null,
  eps: null,
  pb: null,
  dividendYield: null,
  yearHigh: null,
  yearLow: null,
  yearChangePct: null,
});

describe("sector weightage", () => {
  it("shares out the index by market value, biggest sector and company first", () => {
    const { sectors, counted } = sectorWeights([m("A", "IT", 300, 2), m("B", "Banks", 500, -1), m("C", "IT", 200, 1), m("D", "Banks", null)]);
    // D has no market value: left out, not counted as zero.
    expect(counted).toBe(3);
    expect(sectors.map((s) => [s.industry, s.weight])).toEqual([
      ["IT", 50],
      ["Banks", 50],
    ]);
    expect(sectors[0].companies.map((c) => [c.member.symbol, c.weight])).toEqual([
      ["A", 30],
      ["C", 20],
    ]);
    // IT's move today, weighted by size: (30 × 2 + 20 × 1) ÷ 50.
    expect(sectors[0].changePct).toBeCloseTo(1.6, 9);
    expect(sectors.reduce((a, s) => a + s.weight, 0)).toBeCloseTo(100, 9);
  });

  it("has nothing to share without market values", () => {
    expect(sectorWeights([m("A", "IT", null)])).toEqual({ sectors: [], counted: 0 });
  });
});

describe("industry PE", () => {
  const co = (marketCap: number, price: number, eps: number | null) => ({ ...m("X", "IT", marketCap), price, eps });

  it("is total market value ÷ total earnings, losses counting against", () => {
    // Earnings: 1000 × 5 ÷ 100 = 50, and 500 × −2.5 ÷ 100 = −12.5. 1500 ÷ 37.5 = 40.
    expect(groupPe([co(1000, 100, 5), co(500, 100, -2.5)])).toEqual({ pe: 40, count: 2, total: 2 });
  });

  it("isn't swamped by one tiny-profit company the way an average of PEs would be", () => {
    // PEs of 20 and 1000: their average is 510; together the group earns 50 + 0.1 on 1100.
    expect(groupPe([co(1000, 100, 5), co(100, 100, 0.1)]).pe).toBeCloseTo(1100 / 50.1, 9);
  });

  it("leaves out companies without figures, and has no PE for a group that lost money", () => {
    expect(groupPe([co(1000, 100, 5), co(500, 100, null)])).toEqual({ pe: 20, count: 1, total: 2 });
    expect(groupPe([co(1000, 100, -5)]).pe).toBeNull();
  });
});

describe("Yahoo quotes", () => {
  const [nifty, tcs] = parseQuotes({
    quoteResponse: {
      result: [
        { symbol: "^NSEI", regularMarketPrice: 23133.5, regularMarketChangePercent: 0.5920277, regularMarketPreviousClose: 22622.7, regularMarketTime: 1_792_138_074 },
        { symbol: "TCS.NS", regularMarketPrice: 2449.6, regularMarketChangePercent: 4.238, marketCap: 8.86e12, trailingPE: 17.17, epsTrailingTwelveMonths: 142.66, priceToBook: 7.45, trailingAnnualDividendYield: 0.0281 },
      ],
    },
  });

  it("takes an index's change from Yahoo's change percent, not its previous-close field, which can lag a day", () => {
    const q = indexQuote({ symbol: "^NSEI", name: "Nifty 50", list: "ind_nifty50list" }, nifty)!;
    // 23133.5 − 23133.5 ÷ 1.005920277 = 136.15, against NSE's previous close of 22997.35.
    expect(q.change).toBeCloseTo(136.15, 1);
    expect(q).toMatchObject({ name: "Nifty 50", price: 23133.5, open: null, yearChangePct: null });
  });

  it("turns a company's quote into a member with dividend yield in percent, keeping NSE's name and industry", () => {
    const row = member({ symbol: "TCS.NS", name: "Tata Consultancy Services Ltd.", industry: "Information Technology" }, tcs);
    expect(row).toMatchObject({ name: "Tata Consultancy Services Ltd.", industry: "Information Technology", pe: 17.17, pb: 7.45, marketCap: 8.86e12, yearHigh: null });
    expect(row.dividendYield).toBeCloseTo(2.81, 9);
    // A company Yahoo didn't answer for is still listed, with no figures.
    expect(member({ symbol: "X.NS", name: "X", industry: "IT" }, undefined)).toMatchObject({ price: null, marketCap: null, pe: null });
  });
});

describe("company ratios", () => {
  it("reads fractions as percent and Yahoo's debt ÷ equity percentage as times", () => {
    const r = parseRatios("TCS.NS", {
      quoteSummary: {
        result: [
          {
            financialData: { returnOnEquity: { raw: 0.4557 }, debtToEquity: { raw: 9.83 }, profitMargins: { raw: 0.1822 }, earningsGrowth: { raw: 0.15 } },
            defaultKeyStatistics: { enterpriseToEbitda: { raw: 11.148 } },
            summaryDetail: { beta: { raw: 0.182 } },
          },
        ],
      },
    });
    expect(r.roe).toBeCloseTo(45.57, 9);
    expect(r.debtToEquity).toBeCloseTo(0.0983, 9);
    expect(r.profitMargin).toBeCloseTo(18.22, 9);
    expect(r).toMatchObject({ evToEbitda: 11.148, beta: 0.182, roa: null, currentRatio: null });
  });

  it("fails clearly when Yahoo has no such company", () => {
    expect(() => parseRatios("X.NS", { quoteSummary: { result: null } })).toThrow();
  });
});

describe("NSE lists", () => {
  it("reads NSE's list into Yahoo symbols, skipping blanks and repeats", () => {
    const csv = ["﻿Company Name,Industry,Symbol,Series,ISIN Code", '"Mahindra & Mahindra Ltd.",Automobile and Auto Components,M&M,EQ,INE101A01026', "Ashok Leyland Ltd.,Capital Goods,ASHOKLEY,EQ,X", "Ashok Leyland Ltd.,Capital Goods,ASHOKLEY,EQ,X", ""].join("\r\n");
    expect(parseConstituents(csv)).toEqual([
      { name: "Mahindra & Mahindra Ltd.", industry: "Automobile and Auto Components", symbol: "M&M.NS" },
      { name: "Ashok Leyland Ltd.", industry: "Capital Goods", symbol: "ASHOKLEY.NS" },
    ]);
  });

  it("refuses a page that isn't the list", () => {
    expect(() => parseConstituents("<html>blocked</html>")).toThrow();
  });
});

describe("formatting", () => {
  it("writes signs with a true minus and market values in crore", () => {
    expect(formatPct(-0.0225)).toBe("−0.02%");
    expect(formatPct(null)).toBe("—");
    expect(formatCrore(8.86e12)).toBe("₹8,86,000 Cr");
  });
});

describe("old Market page storage", () => {
  it("clears the old page's caches and view choices, nothing else", () => {
    const data = new Map<string, string>([
      ["mm-market-cache:3:/api/market/economy", "{}"],
      ["mm-market-sort:sectors", "pe"],
      ["mm-market-view", "{}"],
      ["mm-market-viewer", "keep"],
      ["mm-sync:pending", "[]"],
      ["money-manager:v1:book", "{}"],
    ]);
    const storage = {
      get length() {
        return data.size;
      },
      key: (i: number) => [...data.keys()][i] ?? null,
      removeItem: (k: string) => void data.delete(k),
    } as Storage;
    expect(dropOldMarketStorage(storage)).toBe(3);
    expect([...data.keys()]).toEqual(["mm-market-viewer", "mm-sync:pending", "money-manager:v1:book"]);
  });
});
