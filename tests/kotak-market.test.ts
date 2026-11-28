import { describe, expect, it } from "vitest";
import { kotakDailyCloses, kotakPrices, parseScripMaster } from "@/lib/brokers/kotak-market";

const CSV = [
  "pSymbol,pGroup,pExchSeg,pInstType,pSymbolName,pTrdSymbol,pOptionType",
  "17388,EQ,nse_cm,,ADANIPOWER,ADANIPOWER-EQ,",
  "99999,BE,nse_cm,,ITC,ITC-BE,",
  "1660,EQ,nse_cm,,ITC,ITC-EQ,",
].join("\n");

const fakeKotak = (calls: string[]) =>
  (async (url: string) => {
    calls.push(url);
    if (url.includes("masterscrip/file-paths")) return new Response(JSON.stringify({ data: { filesPaths: ["https://files.example/2026-11-28/transformed-v1/nse_cm-v1.csv", "https://files.example/nse_fo.csv"] } }));
    if (url.endsWith("nse_cm-v1.csv")) return new Response(CSV);
    if (url.includes("/quotes/neosymbol/")) return new Response(JSON.stringify([{ exchange_token: "17388", ltp: "205.25", change: "-3.05" }, { exchange_token: "1660", ltp: "307.00", change: "1.50" }]));
    if (url.includes("/historical/details")) return new Response(JSON.stringify({ data: { candles: [["2026-11-25T00:00:00+0530", 209.62, 209.77, 204.64, 206, 1], ["2026-11-26T00:00:00+0530", 205.85, 209.8, 205.3, 208.3, 1]] } }));
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;

describe("Kotak Neo prices", () => {
  it("knows a share by Kotak's instrument number, the regular (EQ) series first", () => {
    const m = parseScripMaster(CSV);
    expect(m.get("ADANIPOWER")).toBe("17388");
    expect(m.get("ITC")).toBe("1660");
    expect(m.get("ADANIPOWER-EQ")).toBe("17388");
  });

  it("reads live prices (and the previous close) for many shares in one call", async () => {
    const calls: string[] = [];
    const p = await kotakPrices("tok", ["ADANIPOWER", "ITC", "UNKNOWN"], fakeKotak(calls));
    expect(p).toEqual({ ADANIPOWER: { price: 205.25, prevClose: 208.3 }, ITC: { price: 307, prevClose: 305.5 } });
    expect(calls.filter((c) => c.includes("/quotes/neosymbol/nse_cm|17388,nse_cm|1660/all"))).toHaveLength(1);
  });

  it("reads each day's close", async () => {
    const days = await kotakDailyCloses("tok", "ADANIPOWER", "2026-11-20", "2026-11-28", fakeKotak([]));
    expect(days).toEqual({ "2026-11-25": 206, "2026-11-26": 208.3 });
  });
});
