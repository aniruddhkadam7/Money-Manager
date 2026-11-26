import { describe, expect, it } from "vitest";
import { KotakError, kotakDate, kotakSync, parseHoldings, parsePositions, parseTrades } from "@/lib/brokers/kotak-neo";

const cfg = { token: "test-token", mobile: "+910000000000", ucc: "ABCDE" };

describe("Kotak Neo: reading what it sends", () => {
  it("reads its dates", () => {
    expect(kotakDate("26-Nov-2026", "x")).toBe("2026-11-26");
    expect(kotakDate("5/11/2026", "x")).toBe("2026-11-05");
    expect(kotakDate("2026-11-26 10:15:01", "x")).toBe("2026-11-26");
    expect(kotakDate("", "2026-11-26")).toBe("2026-11-26");
  });

  it("turns the trade book into orders in shares, and counts the rest", () => {
    const { trades, skipped } = parseTrades(
      [
        { exSeg: "nse_cm", trnsTp: "B", fldQty: "10", avgPrc: "2850.50", trdSym: "RELIANCE-EQ", flDt: "26-Nov-2026", flTm: "09:20:15", prod: "MIS", nOrdNo: "1", flId: "a" },
        { exSeg: "bse_cm", trnsTp: "S", fldQty: 5, avgPrc: 101.2, sym: "TATASTEEL", flDt: "26-Nov-2026", prod: "CNC", nOrdNo: "2", flId: "b" },
        { exSeg: "nse_fo", trnsTp: "B", fldQty: "50", avgPrc: "120", trdSym: "NIFTY26NOVFUT", prod: "NRML", nOrdNo: "3" },
      ],
      "2026-11-26",
    );
    expect(skipped).toBe(1);
    expect(trades).toEqual([
      { ref: "kotak:1:a", symbol: "RELIANCE", exchange: "NSE", side: "buy", quantity: 10, priceMinor: 285050, date: "2026-11-26", time: "09:20:15", product: "intraday" },
      { ref: "kotak:2:b", symbol: "TATASTEEL", exchange: "BSE", side: "sell", quantity: 5, priceMinor: 10120, date: "2026-11-26", product: "delivery" },
    ]);
  });

  it("reads positions: open ones, and closed ones with their profit", () => {
    const [closed, open] = parsePositions([
      { trdSym: "ITC-EQ", exSeg: "nse_cm", prod: "MIS", flBuyQty: "10", buyAmt: "4000", flSellQty: "10", sellAmt: "4100" },
      { trdSym: "INFY-EQ", exSeg: "nse_cm", prod: "CNC", flBuyQty: "3", buyAmt: "4500", flSellQty: "0", sellAmt: "0" },
    ]);
    expect(closed).toMatchObject({ symbol: "ITC", market: "NSE", product: "MIS", netQty: 0, buyAvgMinor: 40000, sellAvgMinor: 41000, realizedMinor: 10000 });
    expect(open).toMatchObject({ symbol: "INFY", netQty: 3, buyAvgMinor: 150000, realizedMinor: 0 });
  });

  it("takes \"No holdings found\" as none, not a failure", async () => {
    const fake = (async (url: string) => {
      if (url.endsWith("tradeApiLogin")) return new Response(JSON.stringify({ data: { token: "v", sid: "s" } }));
      if (url.endsWith("tradeApiValidate")) return new Response(JSON.stringify({ data: { token: "t", sid: "s" } }));
      if (url.endsWith("/portfolio/v1/holdings")) return new Response(JSON.stringify({ error: [{ code: "424", message: "No holdings found for this client X" }] }), { status: 424 });
      return new Response(JSON.stringify({ stat: "Ok", data: [] }));
    }) as unknown as typeof fetch;
    const r = await kotakSync(cfg, "123456", "123456", "2026-11-26", fake);
    expect(r.holdings).toEqual([]);
  });

  it("reads holdings", () => {
    expect(parseHoldings([{ displaySymbol: "INFY", quantity: 3, averagePrice: 1500, closingPrice: 1600.5, mktValue: 4801.5 }, { symbol: "OLD", quantity: 0 }])).toEqual([
      { symbol: "INFY", quantity: 3, avgPriceMinor: 150000, closePriceMinor: 160050, valueMinor: 480150 },
    ]);
  });
});

describe("Kotak Neo: the sync", () => {
  it("logs in with the TOTP, checks the MPIN, then reads trades and holdings from the server it names", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
      if (url.endsWith("/login/1.0/tradeApiLogin")) return ok({ data: { token: "view", sid: "s1" } });
      if (url.endsWith("/login/1.0/tradeApiValidate")) return ok({ data: { token: "trade", sid: "s2", baseUrl: "https://e21.kotaksecurities.com" } });
      if (url.endsWith("/quick/user/trades")) return ok({ stat: "Ok", data: [{ exSeg: "nse_cm", trnsTp: "B", fldQty: "1", avgPrc: "10", trdSym: "ITC-EQ", nOrdNo: "9", flId: "z", prod: "CNC" }] });
      if (url.endsWith("/portfolio/v1/holdings")) return ok({ data: [] });
      if (url.endsWith("/quick/user/limits")) return ok({ Net: "12500.5", MarginUsed: "3000", CollateralValue: "0", RmsPayInAmt: "10000", RmsPayOutAmt: "0", stat: "Ok" });
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    const r = await kotakSync(cfg, "123456", "1234", "2026-11-26", fake);
    expect(r.trades.map((t) => t.symbol)).toEqual(["ITC"]);
    expect(r.funds).toEqual({ availableMinor: 1250050, marginUsedMinor: 300000, collateralMinor: 0, payInMinor: 1000000, payOutMinor: 0 });
    expect(calls.map((c) => c.url)).toEqual([
      "https://mis.kotaksecurities.com/login/1.0/tradeApiLogin",
      "https://mis.kotaksecurities.com/login/1.0/tradeApiValidate",
      "https://e21.kotaksecurities.com/quick/user/trades",
      "https://e21.kotaksecurities.com/portfolio/v1/holdings",
      "https://e21.kotaksecurities.com/quick/user/limits",
      "https://e21.kotaksecurities.com/quick/user/positions",
    ]);
    expect(String(calls[4].init.body)).toBe(`jData=${encodeURIComponent('{"seg":"ALL","exch":"ALL","prod":"ALL"}')}`);
    const h = (i: number) => calls[i].init.headers as Record<string, string>;
    expect(h(0)).toMatchObject({ authorization: "test-token", "neo-fin-key": "neotradeapi" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ mobileNumber: cfg.mobile, ucc: cfg.ucc, totp: "123456" });
    expect(h(1)).toMatchObject({ sid: "s1", Auth: "view" });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ mpin: "1234" });
    expect(h(2)).toMatchObject({ Sid: "s2", Auth: "trade" });
    // Only reading: the trade book and holdings are GETs; funds is Kotak's read-only "limits" report.
    expect(calls.slice(2, 4).every((c) => c.init.method === "GET")).toBe(true);
    expect(calls.every((c) => !/order\/(place|modify|cancel)|\/order\b/.test(c.url))).toBe(true);
  });

  it("takes Kotak's \"No Data\" (no trades today) as an empty list", async () => {
    const fake = (async (url: string) => {
      if (url.endsWith("tradeApiLogin")) return new Response(JSON.stringify({ data: { token: "v", sid: "s" } }));
      if (url.endsWith("tradeApiValidate")) return new Response(JSON.stringify({ data: { token: "t", sid: "s", baseUrl: "https://e1.kotaksecurities.com" } }));
      if (url.endsWith("/quick/user/trades")) return new Response(JSON.stringify({ stat: "Not_Ok", stCode: 5203, errMsg: "No Data" }), { status: 200 });
      return new Response(JSON.stringify({ data: [{ displaySymbol: "ITC", quantity: 2, averagePrice: 400, closingPrice: 410, mktValue: 820 }] }));
    }) as unknown as typeof fetch;
    const r = await kotakSync(cfg, "123456", "123456", "2026-11-26", fake);
    expect(r.trades).toEqual([]);
    expect(r.holdings.map((h) => h.symbol)).toEqual(["ITC"]);
  });

  it("says so when the TOTP is refused", async () => {
    const fake = (async () => new Response(JSON.stringify({ message: "Invalid TOTP" }), { status: 401 })) as unknown as typeof fetch;
    await expect(kotakSync(cfg, "000000", "1234", "2026-11-26", fake)).rejects.toEqual(new KotakError("Login: Invalid TOTP", 401));
  });
});

describe("Kotak Neo: the day's sealed session", () => {
  const env = { KOTAK_NEO_TOKEN: "server-secret" };
  const s = { sid: "sid1", token: "tok1", base: "https://e21.kotaksecurities.com" };

  it("opens what it sealed, the same day only", async () => {
    const { sealSession, openSession } = await import("@/lib/brokers/kotak-session");
    const noon = Date.parse("2026-11-26T06:30:00Z"); // 12:00 in India
    const sealed = sealSession(env, s, noon)!;
    expect(sealed).not.toContain("tok1");
    expect(openSession(env, sealed, noon + 3600_000)).toEqual(s);
    // After midnight in India it's over.
    expect(openSession(env, sealed, Date.parse("2026-11-26T18:31:00Z"))).toBeNull();
  });

  it("refuses one that was changed, or sealed with another key", async () => {
    const { sealSession, openSession } = await import("@/lib/brokers/kotak-session");
    const sealed = sealSession(env, s)!;
    const [iv, tag, body] = sealed.split(".");
    const flipped = body.slice(0, -2) + (body.endsWith("A") ? "B" : "A") + body.slice(-1);
    expect(openSession(env, `${iv}.${tag}.${flipped}`)).toBeNull();
    expect(openSession({ KOTAK_NEO_TOKEN: "other" }, sealed)).toBeNull();
    expect(openSession(env, "nonsense")).toBeNull();
  });

  it("never sends a session anywhere but Kotak's own servers", async () => {
    const { kotakRead } = await import("@/lib/brokers/kotak-neo");
    const fake = (async () => new Response("{}")) as unknown as typeof fetch;
    await expect(kotakRead({ ...s, base: "https://evil.example.com" }, "2026-11-26", fake)).rejects.toThrow("Unexpected Kotak server.");
  });
});

describe("TOTP codes made on the server", () => {
  it("match the RFC 6238 test vectors (SHA-1)", async () => {
    const { totpCode } = await import("@/lib/brokers/totp");
    // RFC 6238 appendix B: secret "12345678901234567890" (base32 below), 8 digits.
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(totpCode(secret, 59_000, 30, 8)).toBe("94287082");
    expect(totpCode(secret, 1111111109_000, 30, 8)).toBe("07081804");
    expect(totpCode(secret, 1234567890_000, 30, 8)).toBe("89005924");
    expect(totpCode(secret, 2000000000_000, 30, 8)).toBe("69279037");
    expect(totpCode(secret, 59_000)).toBe("287082");
  });
});
