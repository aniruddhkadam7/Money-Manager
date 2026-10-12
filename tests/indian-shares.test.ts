import { describe, expect, it } from "vitest";
import { indianShares } from "@/lib/market/indian-shares";

describe("indianShares", () => {
  it("keeps NSE and BSE shares, one per company, NSE first, with the bare trading symbol", () => {
    const hits = [
      { symbol: "RELIANCE.BO", name: "Reliance Industries Limited", exchange: "Bombay", kind: "equity" as const },
      { symbol: "RELIANCE.NS", name: "Reliance Industries Limited", exchange: "NSE", kind: "equity" as const },
      { symbol: "RPOWER.NS", name: "Reliance Power Limited", exchange: "NSE", kind: "equity" as const },
      { symbol: "RS", name: "Reliance, Inc.", exchange: "NYSE", kind: "equity" as const },
      { symbol: "^NSEI", name: "NIFTY 50", exchange: "NSE", kind: "index" as const },
    ];
    expect(indianShares(hits)).toEqual([
      { symbol: "RELIANCE", name: "Reliance Industries Limited", exchange: "NSE" },
      { symbol: "RPOWER", name: "Reliance Power Limited", exchange: "NSE" },
    ]);
  });
});
