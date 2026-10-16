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
