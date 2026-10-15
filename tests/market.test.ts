import { describe, expect, it } from "vitest";
import { sortItems, type QuoteSort } from "@/components/market/sort";
import { parseConstituents } from "@/lib/market/constituents";
import { parseBis, parseImf } from "@/lib/market/economy";
import { fundChart, fundQuote, parseFundHistory } from "@/lib/market/funds";
import { formatChange, formatPct, formatPrice, formatReturn } from "@/lib/market/format";
import { dailySpark, inRupees, memberIndex, performance, prevCloseFromDaily, sparkFor } from "@/lib/market/perf";
import { multiplySeries } from "@/lib/market/service";
import type { Quote } from "@/lib/market/types";
import { parseIbja, spliceHistory } from "@/lib/market/ibja";
import { groupPe, parseNseIndices } from "@/lib/market/valuation";
import { parseChart, parseSearch } from "@/lib/market/yahoo";

const DAY = 86_400;
const chart = (meta: Record<string, unknown>, timestamp: number[], close: (number | null)[]) => ({
  chart: { result: [{ meta, timestamp, indicators: { quote: [{ close }] } }], error: null },
});

describe("parseChart", () => {
  const meta = {
    symbol: "^NSEI",
    currency: "INR",
    instrumentType: "INDEX",
    regularMarketPrice: 22363.7,
    chartPreviousClose: 22520.45,
    regularMarketTime: 1_000_300,
    gmtoffset: 19_800,
    shortName: "NIFTY 50",
    fullExchangeName: "NSE",
    exchangeTimezoneName: "Asia/Kolkata",
  };

  it("reads the price and drops gaps in the line", () => {
    const c = parseChart(chart(meta, [1_000_000, 1_000_300, 1_000_600], [22500, null, 22363.7]));
    expect(c).toMatchObject({ symbol: "^NSEI", kind: "index", price: 22363.7, chartPrevClose: 22520.45, exchange: "NSE", gmtoffset: 19_800 });
    expect(c.points).toEqual([
      { t: 1_000_000, v: 22500 },
      { t: 1_000_600, v: 22363.7 },
    ]);
  });

  it("prefers the normal-case long name over the capitals of the short one", () => {
    expect(parseChart(chart({ ...meta, longName: "Reliance Industries Limited", shortName: "RELIANCE INDUSTRIES LTD" }, [], [])).name).toBe(
      "Reliance Industries Limited",
    );
  });

  it("treats US Treasury yields as yields, not indices", () => {
    expect(parseChart(chart({ ...meta, symbol: "^TNX" }, [], [])).kind).toBe("yield");
  });

  it("fails clearly when Yahoo has no such symbol", () => {
    expect(() => parseChart({ chart: { result: null, error: { code: "Not Found" } } })).toThrow();
  });
});

describe("parseSearch", () => {
  it("keeps chartable results and lists Indian ones first", () => {
    const hits = parseSearch({
      quotes: [
        { symbol: "RS", longname: "Reliance, Inc.", exchDisp: "NYSE", quoteType: "EQUITY" },
        { symbol: "RELIANCE.NS", shortname: "RELIANCE INDUSTRIES LTD", longname: "Reliance Industries Limited", exchDisp: "NSE", quoteType: "EQUITY" },
        { symbol: "X", quoteType: "OPTION" },
        { index: "news" },
      ],
    });
    expect(hits.map((h) => h.symbol)).toEqual(["RELIANCE.NS", "RS"]);
    expect(hits[0]).toEqual({ symbol: "RELIANCE.NS", name: "Reliance Industries Limited", exchange: "NSE", kind: "equity" });
  });
});

describe("returns from daily closes", () => {
  // IST is UTC+5:30; a close stamped at 09:15 IST on each of these days.
  const IST = 19_800;
  const day0 = Date.UTC(2026, 9, 5) / 1000 + 3 * 3600 + 45 * 60;
  const days = (values: number[]) => values.map((v, i) => ({ t: day0 + i * DAY, v }));

  it("measures the day from the close before today's while today is trading", () => {
    const pts = days([100, 102, 101]);
    expect(prevCloseFromDaily(pts, pts[2].t + 3 * 3600, IST)).toBe(102);
  });

  it("measures from the last close when today has no bar yet", () => {
    const pts = days([100, 102, 101]);
    expect(prevCloseFromDaily(pts, pts[2].t + DAY, IST)).toBe(101);
  });

  it("returns over each period, and nothing where the history is too short", () => {
    const year = Array.from({ length: 366 }, (_, i) => ({ t: day0 + i * DAY, v: 100 + i }));
    const p = performance(year, 465, 464);
    expect(p["1d"]).toBeCloseTo((1 / 464) * 100, 6);
    expect(p["1w"]).toBeCloseTo((7 / 458) * 100, 6);
    expect(p["1y"]).toBeCloseTo(365, 6);
    expect(performance(year.slice(-40), 465, 464)["3m"]).toBeNull();
  });

  it("builds an equal-weighted index from members' daily moves, letting a late listing join", () => {
    const a = days([100, 110, 121]); // +10%, +10%
    const b = days([50, 45]); // −10%, then no price that day
    const c = days([0, 0, 20]).slice(2); // lists on day 3: no move counted yet
    const idx = memberIndex([a, b, c]);
    expect(idx.map((p) => +p.v.toFixed(6))).toEqual([100, 100, 110]);
  });

  it("weights members by company size when share counts are known", () => {
    const big = days([100, 110]); // +10%, worth 100 × 9 = 900
    const small = days([100, 80]); // −20%, worth 100 × 1 = 100
    expect(memberIndex([big, small], [9, 1]).at(-1)!.v).toBeCloseTo(100 * (1 + (900 * 0.1 + 100 * -0.2) / 1000), 9);
    // A member with no share count doesn't sway it.
    expect(memberIndex([big, small], [9, null]).at(-1)!.v).toBeCloseTo(110, 9);
  });

  it("keeps up to a year of daily closes, rounded, and cuts them to the period shown", () => {
    const s = dailySpark(days(Array.from({ length: 300 }, (_, i) => 1000 + i / 7)));
    expect(s).toHaveLength(260);
    expect(s.at(-1)).toBe(1042.7);
    expect(sparkFor(s, "1m")).toEqual(s.slice(-23));
    expect(sparkFor(s, "1y")).toBe(s);
    expect(sparkFor([1, 2, 3], "3m")).toEqual([1, 2, 3]);
  });
});

describe("mutual funds", () => {
  const json = {
    meta: { scheme_name: "Parag Parikh Flexi Cap Fund - Direct Plan - Growth", fund_house: "PPFAS Mutual Fund" },
    // mfapi lists newest first
    data: [
      { date: "09-10-2026", nav: "88.92580" },
      { date: "08-10-2026", nav: "88.00000" },
      { date: "07-10-2026", nav: "87.50000" },
    ],
  };

  it("reads NAVs oldest first and measures the change from the NAV before", () => {
    const h = parseFundHistory(json);
    expect(h.points.map((p) => p.v)).toEqual([87.5, 88, 88.9258]);
    const q = fundQuote("MF:122639", h);
    expect(q).toMatchObject({ kind: "fund", currency: "INR", price: 88.9258, prevClose: 88, exchange: "PPFAS Mutual Fund", time: Date.UTC(2026, 9, 9) / 1000 });
    expect(q.changePct).toBeCloseTo(1.052, 3);
    expect(q.perf["1d"]).toBeCloseTo(1.052, 3);
  });

  it("cuts the history to the range", () => {
    expect(fundChart("MF:1", "1mo", parseFundHistory(json)).points).toHaveLength(3);
  });
});

describe("economy", () => {
  it("takes seven actual years and two ahead from the IMF, marking this year on as forecasts", () => {
    const json = { values: { "": null, NGDP_RPCH: { "": null, IND: { "2018": 6.5, "2019": 3.9, "2022": 7, "2023": 9.2, "2024": 6.5, "2025": 7.6, "2026": 6.5, "2027": 6.5, "2028": 6.4 }, USA: {} } } };
    const out = parseImf(json, "NGDP_RPCH", ["IND", "USA", "XXX"], 2026);
    // 2018 is too old; years the IMF has no figure for are simply missing.
    expect(out.IND).toEqual([
      { year: 2019, value: 3.9, forecast: false },
      { year: 2022, value: 7, forecast: false },
      { year: 2023, value: 9.2, forecast: false },
      { year: 2024, value: 6.5, forecast: false },
      { year: 2025, value: 7.6, forecast: false },
      { year: 2026, value: 6.5, forecast: true },
      { year: 2027, value: 6.5, forecast: true },
    ]);
    expect(out.USA).toEqual([]);
    expect(out.XXX).toEqual([]);
  });

  it("reads BIS policy rates and finds each bank's latest move", () => {
    const csv = [
      "FREQ,REF_AREA,TIME_PERIOD,OBS_VALUE",
      "M,US,2026-07,3.625",
      "M,US,2026-08,3.625",
      "M,US,2026-09,3.875",
      "M,IN,2026-07,5.5",
      "M,IN,2026-08,5.25",
      "M,IN,2026-09,5.25",
      "M,JP,2026-08,0.5",
      "M,JP,2026-09,",
      "M,CN,2026-09,3",
    ].join("\r\n");
    const out = parseBis(csv, { US: "Fed", IN: "RBI" });
    expect(out.US).toEqual({ bank: "Fed", rate: 3.875, asOf: "2026-09", lastChange: { month: "2026-09", by: 0.25 }, history: [3.625, 3.625, 3.875] });
    expect(out.IN.lastChange).toEqual({ month: "2026-08", by: -0.25 });
    expect(out.IN.rate).toBe(5.25);
    expect(out.JP).toMatchObject({ rate: 0.5, asOf: "2026-08" });
    expect(out.CN).toMatchObject({ bank: "CN", lastChange: null });
  });
});

describe("multiplySeries", () => {
  it("multiplies by the other series' latest value at each time", () => {
    const gold = [
      { t: 10, v: 2 },
      { t: 20, v: 3 },
      { t: 30, v: 4 },
    ];
    const fx = [
      { t: 15, v: 10 },
      { t: 25, v: 100 },
    ];
    expect(multiplySeries(gold, fx, 1).map((p) => p.v)).toEqual([20, 30, 400]);
  });
});

describe("formatting", () => {
  it("shows indices as points, yields as percent and everything else in its currency", () => {
    expect(formatPrice(22363.7, { kind: "index", currency: "INR" })).toBe("22,363.70");
    expect(formatPrice(5.244, { kind: "yield", currency: "USD" })).toBe("5.24%");
    expect(formatPrice(8022857, { kind: "crypto", currency: "INR" })).toBe("₹80,22,857.00");
    expect(formatPrice(4210, { kind: "commodity", currency: "USD" })).toBe("$4,210.00");
  });

  it("spells out the sign with a true minus, and a dash for a missing return", () => {
    expect(formatChange(-156.75)).toBe("−156.75");
    expect(formatPct(0.696)).toBe("+0.70%");
    expect(formatPct(0)).toBe("0.00%");
    expect(formatReturn(-3.456)).toBe("−3.5%");
    expect(formatReturn(null)).toBe("—");
  });
});

describe("sector constituents", () => {
  it("reads NSE's list into Yahoo symbols, skipping blanks and repeats", () => {
    const csv = [
      "\uFEFFCompany Name,Industry,Symbol,Series,ISIN Code",
      "Ashok Leyland Ltd.,Capital Goods,ASHOKLEY,EQ,INE208A01029",
      '"Mahindra & Mahindra Ltd.",Automobile and Auto Components,M&M,EQ,INE101A01026',
      "Bajaj-Auto Ltd.,Automobile and Auto Components,BAJAJ-AUTO,EQ,INE917I01010",
      "Ashok Leyland Ltd.,Capital Goods,ASHOKLEY,EQ,INE208A01029",
      "",
    ].join("\r\n");
    expect(parseConstituents(csv)).toEqual([
      { name: "Ashok Leyland Ltd.", industry: "Capital Goods", symbol: "ASHOKLEY.NS" },
      { name: "Mahindra & Mahindra Ltd.", industry: "Automobile and Auto Components", symbol: "M&M.NS" },
      { name: "Bajaj-Auto Ltd.", industry: "Automobile and Auto Components", symbol: "BAJAJ-AUTO.NS" },
    ]);
  });

  it("refuses a page that isn't the list", () => {
    expect(() => parseConstituents("<html>blocked</html>")).toThrow();
  });
});

describe("sorting quote lists", () => {
  const q = (symbol: string, price: number, m: number | null) =>
    ({ symbol, name: symbol, price, perf: { "1d": null, "1w": null, "1m": m, "3m": null, "1y": null } }) as unknown as Quote;
  const quotes: Record<string, Quote> = { B: q("B", 50, 5), C: q("C", 10, -2), D: q("D", 99, null) };
  const items = ["C", "A", "D", "B"]; // A is still loading
  const run = (sort: QuoteSort) => sortItems(items, sort, "1m", (s) => quotes[s], (s) => s);

  it("keeps the usual order, or sorts by return, name or price", () => {
    expect(run("listed")).toEqual(["C", "A", "D", "B"]);
    expect(run("best")).toEqual(["B", "C", "A", "D"]);
    expect(run("worst")).toEqual(["C", "B", "A", "D"]);
    expect(run("name")).toEqual(["A", "B", "C", "D"]);
    expect(run("priceHigh")).toEqual(["D", "B", "C", "A"]);
    expect(run("priceLow")).toEqual(["C", "B", "D", "A"]);
  });
});

describe("inRupees", () => {
  it("compounds a dollar return with the rupee's fall (or rise) against the dollar", () => {
    expect(inRupees(10, 5)).toBeCloseTo(15.5, 9);
    expect(inRupees(-10, 5)).toBeCloseTo(-5.5, 9);
    expect(inRupees(10, null)).toBeNull();
  });
});

describe("valuations", () => {
  it("reads NSE's index figures, leaving out the ones it doesn't have", () => {
    const { asOf, indices } = parseNseIndices({
      timestamp: "15-Oct-2026 15:30",
      data: [
        { index: "NIFTY 50", pe: "19.65", pb: "2.82", dy: "1.49" },
        { index: "INDIA VIX", pe: "0", pb: "0", dy: "-" },
      ],
    });
    expect(asOf).toBe("15-Oct-2026 15:30");
    expect(indices["NIFTY 50"]).toEqual({ pe: 19.65, pb: 2.82, dy: 1.49 });
    expect(indices["INDIA VIX"]).toEqual({ pe: null, pb: null, dy: null });
  });

  it("works out a group's PE as total value over total earnings, losses counting against", () => {
    const stock = (marketCap: number, eps: number, shares: number) => ({ marketCap, eps, shares, pe: null });
    // Values 1000 + 500; earnings 50 + (−25): 1500 ÷ 25 = 60.
    expect(groupPe([stock(1000, 5, 10), stock(500, -2.5, 10)])).toEqual({ pe: 60, count: 2, total: 2 });
    // Stocks without figures are counted as missing, not as zero.
    expect(groupPe([stock(1000, 5, 10), undefined])).toEqual({ pe: 20, count: 1, total: 2 });
    // A group that lost money overall has no PE.
    expect(groupPe([stock(1000, -5, 10)]).pe).toBeNull();
  });
});

describe("IBJA bullion rates", () => {
  const page = (goldPm: string, goldAm = "145564") => `
    <span id="lblGold999_AM">${goldAm}</span><span id="lblGold999_PM">${goldPm}</span>
    <span id="lblSilver999_AM">207098</span><span id="lblSilver999_PM">208275</span>
    <input type="hidden" name="HdnGold" id="HdnGold" value="{&quot;labels&quot;:[&quot;14/10/2026&quot;,&quot;15/10/2026&quot;],&quot;purity999&quot;:[146064,145942],&quot;purity916&quot;:[1,2]}" />
    <input type="hidden" name="HdnSilver" id="HdnSilver" value="{&quot;labels&quot;:[&quot;14/10/2026&quot;,&quot;15/10/2026&quot;],&quot;silverRate&quot;:[213822,208275]}" />`;

  it("reads each day's rate, dated at 6 PM in India", () => {
    const { gold999, silver999 } = parseIbja(page("145942"), 2_000_000_000);
    expect(gold999.history).toEqual([
      { t: Date.UTC(2026, 9, 14, 12, 30) / 1000, v: 146064 },
      { t: Date.UTC(2026, 9, 15, 12, 30) / 1000, v: 145942 },
    ]);
    expect(gold999.session).toBe("PM");
    expect(silver999.history.at(-1)?.v).toBe(208275);
  });

  it("adds today's rate when it's newer than the history, preferring the 6 PM one", () => {
    expect(parseIbja(page("147000"), 2_000_000_000).gold999.history.at(-1)).toEqual({ t: 2_000_000_000, v: 147000 });
    // Only the noon rate is out yet.
    const noon = parseIbja(page("", "146500"), 2_000_000_000).gold999;
    expect(noon.history.at(-1)).toEqual({ t: 2_000_000_000, v: 146500 });
    expect(noon.session).toBe("AM");
  });

  it("joins older prices on, scaled to meet IBJA's first rate", () => {
    const older = [
      { t: 1, v: 50 },
      { t: 2, v: 100 },
      { t: 5, v: 999 },
    ];
    expect(spliceHistory(older, [{ t: 3, v: 120 }, { t: 4, v: 130 }])).toEqual([
      { t: 1, v: 60 },
      { t: 2, v: 120 },
      { t: 3, v: 120 },
      { t: 4, v: 130 },
    ]);
  });
});
