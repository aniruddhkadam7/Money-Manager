import { afterEach, describe, expect, it, vi } from "vitest";

// India time (UTC+5:30), written as a Date.
const ist = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.parse(`${date}T00:00:00Z`) + (h * 60 + m - 330) * 60_000);
};

/** The index's last trade at `when`, as the price service reports it. */
const indexTradedAt = (when: Date) =>
  vi.fn(async () => new Response(JSON.stringify({ prices: { "^NSEI": { price: 25000, prevClose: 24900, time: Math.floor(when.getTime() / 1000) } } })));

async function fresh() {
  vi.resetModules();
  return import("@/lib/stocks/trading-day");
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("is the market trading now", () => {
  it("yes on a trading day in market hours (the index traded today)", async () => {
    vi.useFakeTimers({ now: ist("2026-11-26", "11:00") });
    vi.stubGlobal("fetch", indexTradedAt(ist("2026-11-26", "10:59")));
    const { refreshTradingDay, tradingNow } = await fresh();
    expect(await refreshTradingDay()).toBe(true);
    expect(tradingNow()).toBe(true);
  });

  it("no on an exchange holiday (a weekday, but the index last traded the day before)", async () => {
    vi.useFakeTimers({ now: ist("2026-12-25", "11:00") });
    vi.stubGlobal("fetch", indexTradedAt(ist("2026-12-24", "15:30")));
    const { refreshTradingDay, tradingNow } = await fresh();
    expect(await refreshTradingDay()).toBe(false);
    expect(tradingNow()).toBe(false);
  });

  it("no after hours or at weekends, without even asking", async () => {
    const f = indexTradedAt(new Date());
    vi.stubGlobal("fetch", f);
    vi.useFakeTimers({ now: ist("2026-11-26", "20:00") });
    expect(await (await fresh()).refreshTradingDay()).toBe(false);
    vi.useFakeTimers({ now: ist("2026-11-28", "11:00") }); // Saturday
    expect(await (await fresh()).refreshTradingDay()).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("asks once and trusts it for the day once trading is seen", async () => {
    vi.useFakeTimers({ now: ist("2026-11-26", "11:00") });
    const f = indexTradedAt(ist("2026-11-26", "10:59"));
    vi.stubGlobal("fetch", f);
    const { refreshTradingDay } = await fresh();
    await refreshTradingDay();
    vi.setSystemTime(ist("2026-11-26", "13:00"));
    await refreshTradingDay();
    expect(f).toHaveBeenCalledTimes(1);
  });
});
