import { describe, expect, it } from "vitest";
import { parseLastPrice, parseSearch } from "@/lib/stocks/yahoo";

describe("parseSearch", () => {
  it("keeps priced results and lists Indian ones first", () => {
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

describe("parseLastPrice", () => {
  it("reads the last price, the previous close and its time", () => {
    const json = { chart: { result: [{ meta: { regularMarketPrice: 2449.6, chartPreviousClose: 2350, regularMarketTime: 1_792_136_813 } }] } };
    expect(parseLastPrice(json)).toEqual({ price: 2449.6, prevClose: 2350, time: 1_792_136_813 });
  });

  it("fails clearly when Yahoo has no such symbol", () => {
    expect(() => parseLastPrice({ chart: { result: null, error: { code: "Not Found" } } })).toThrow();
  });
});

describe("a share's sector, from Yahoo's search", () => {
  it("reads the sector and industry of that exact symbol", async () => {
    const { parseSector } = await import("@/lib/stocks/yahoo");
    const json = {
      quotes: [
        { symbol: "ITC.BO", quoteType: "EQUITY", sector: "Wrong one" },
        { symbol: "ITC.NS", quoteType: "EQUITY", sector: "Consumer Defensive", industry: "Tobacco" },
      ],
    };
    expect(parseSector(json, "ITC.NS")).toEqual({ sector: "Consumer Defensive", industry: "Tobacco" });
    expect(parseSector({ quotes: [] }, "ITC.NS")).toEqual({ sector: null, industry: null });
  });
});

describe("daily closing prices", () => {
  it("are read by India date, skipping days without a close", async () => {
    const { parseDailyCloses } = await import("@/lib/stocks/yahoo");
    const t = (iso: string) => Date.parse(iso) / 1000;
    const json = { chart: { result: [{ timestamp: [t("2026-11-25T03:45:00Z"), t("2026-11-26T03:45:00Z"), t("2026-11-27T03:45:00Z")], indicators: { quote: [{ close: [206, null, 205.25] }] } }] } };
    expect(parseDailyCloses(json)).toEqual({ "2026-11-25": 206, "2026-11-27": 205.25 });
  });
});
