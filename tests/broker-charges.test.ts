import { describe, expect, it } from "vitest";
import { brokerCharges, KOTAK_NEO_RATES } from "@/lib/trading/charges";

describe("Kotak Neo charges", () => {
  it("a ₹10,000 delivery sale: 0.2% brokerage, STT, exchange, SEBI, GST and the ₹20 DP minimum (+GST)", () => {
    const c = brokerCharges({ product: "delivery", side: "sell", valueMinor: 1_000_000 }, KOTAK_NEO_RATES);
    expect(c).toEqual({ brokerage: 2000, stt: 1000, exchange: 31, sebi: 1, gst: 366, stamp: 0, dp: 2360, total: 5758 });
  });

  it("a big delivery sale pays DP as 0.04% of it, not the minimum", () => {
    const c = brokerCharges({ product: "delivery", side: "sell", valueMinor: 10_000_000 }, KOTAK_NEO_RATES);
    // 0.04% of ₹1,00,000 = ₹40, plus 18% GST.
    expect(c.dp).toBe(4720);
    expect(c.brokerage).toBe(20000);
  });

  it("intraday: ₹10 or 0.05%, whichever is lower; STT only on the sell; no DP", () => {
    const small = brokerCharges({ product: "intraday", side: "sell", valueMinor: 1_000_000 }, KOTAK_NEO_RATES);
    expect(small.brokerage).toBe(500); // 0.05% of ₹10,000 = ₹5
    expect(small.dp).toBe(0);
    const big = brokerCharges({ product: "intraday", side: "buy", valueMinor: 10_000_000 }, KOTAK_NEO_RATES);
    expect(big.brokerage).toBe(1000); // capped at ₹10
    expect(big.stt).toBe(0);
    expect(big.stamp).toBe(300); // 0.003% on intraday buys
  });

  it("DP is charged once per stock per day", () => {
    expect(brokerCharges({ product: "delivery", side: "sell", valueMinor: 1_000_000, dpAlreadyCharged: true }, KOTAK_NEO_RATES).dp).toBe(0);
  });
});
