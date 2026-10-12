import { describe, expect, it } from "vitest";
import { fill } from "@/lib/finance/fifo";
import { zerodhaCharges } from "@/lib/trading/charges";
import { buildJournal, dayPositions, periodStats } from "@/lib/trading/journal";
import type { TradeSide } from "@/lib/finance/types";
import { rs, startingScenario } from "./helpers";

function setup() {
  const { s, hdfc } = startingScenario();
  const trade = (holdingId: string, side: TradeSide, quantity: number, price: number, time: string, chargesMinor = 0, date = "2026-10-03") =>
    s.record({ type: "trade", date, time, holdingId, side, quantity, priceMinor: rs(price), chargesMinor, accountId: hdfc.id });
  return { s, hdfc, trade };
}

describe("FIFO matching", () => {
  it("closes the oldest lots first and flips past zero", () => {
    let f = fill([], 1, 10, 100);
    f = fill(f.lots, 1, 10, 110);
    const sell = fill(f.lots, -1, 15, 120);
    expect(sell.closedQuantity).toBe(15);
    expect(sell.closedCostMinor).toBe(10 * 100 + 5 * 110);
    expect(sell.grossMinor).toBe(15 * 120 - (10 * 100 + 5 * 110));
    const flip = fill(sell.lots, -1, 8, 130);
    expect(flip.closedQuantity).toBe(5);
    expect(flip.lots).toEqual([{ quantity: -3, priceMinor: 130 }]);
  });
});

describe("stock orders in the ledger", () => {
  it("books an intraday long: profit less charges, cash back where it started", () => {
    const { s, hdfc, trade } = setup();
    const rel = s.investment("RELIANCE", "intraday");
    expect(trade(rel.id, "buy", 100, 2850, "09:20", rs(30)).ok).toBe(true);
    expect(trade(rel.id, "sell", 100, 2862.5, "09:41", rs(50)).ok).toBe(true);

    const st = s.state();
    const h = st.investments.holdings.find((x) => x.account.id === rel.id)!;
    expect(h.valueMinor).toBe(0);
    expect(h.realizedMinor).toBe(rs(1250 - 80));
    const bank = st.accounts.find((a) => a.account.id === hdfc.id)!;
    expect(bank.balanceMinor).toBe(rs(500_000 + 1250 - 80));
    expect(s.report().investmentGainMinor).toBe(rs(1170));
  });

  it("lets MIS sell first and buy back (a short), but not CNC", () => {
    const { s, trade } = setup();
    const mis = s.investment("INFY", "intraday");
    expect(trade(mis.id, "sell", 50, 1500, "10:00").ok).toBe(true);
    expect(trade(mis.id, "buy", 50, 1490, "10:05").ok).toBe(true);
    const h = s.state().investments.holdings.find((x) => x.account.id === mis.id)!;
    expect(h.realizedMinor).toBe(rs(500));

    const cnc = s.investment("INFY", "delivery");
    const r = trade(cnc.id, "sell", 1, 1500, "10:10");
    expect(r.ok).toBe(false);
  });

  it("orders a day's trades by time, not by when they were typed in", () => {
    const { s, trade } = setup();
    const tcs = s.investment("TCS", "delivery");
    // The sell is entered first but happened later in the day.
    expect(trade(tcs.id, "sell", 10, 4100, "14:00").ok).toBe(false);
    expect(trade(tcs.id, "buy", 10, 4000, "10:00").ok).toBe(true);
    const sell = trade(tcs.id, "sell", 10, 4100, "14:00");
    expect(sell.ok).toBe(true);
  });

  it("refuses amount-based buys and value updates on a stock", () => {
    const { s, hdfc } = setup();
    const rel = s.investment("RELIANCE", "delivery");
    expect(s.record({ type: "invest", date: "2026-10-03", fromAccountId: hdfc.id, holdingId: rel.id, amountMinor: rs(100) }).ok).toBe(false);
  });
});

describe("trading journal", () => {
  it("counts round trips, wins and losses after charges", () => {
    const { s, trade } = setup();
    const a = s.investment("SBIN", "intraday");
    trade(a.id, "buy", 100, 800, "09:16", rs(20));
    trade(a.id, "sell", 100, 805, "09:20", rs(20)); // +500 - 40 = +460
    trade(a.id, "sell", 100, 806, "09:30", rs(20));
    trade(a.id, "buy", 100, 808, "09:35", rs(20)); // -200 - 40 = -240
    const j = buildJournal(s.book, s.ledger);
    expect(j.roundTrips.map((t) => [t.direction, t.netMinor])).toEqual([
      ["long", rs(460)],
      ["short", rs(-240)],
    ]);
    const p = periodStats(j, "2026-10-03", "2026-10-03");
    expect(p.netMinor).toBe(rs(220));
    expect(p.chargesMinor).toBe(rs(80));
    expect(p.winRate).toBe(0.5);
    expect(p.profitFactor).toBeCloseTo(460 / 240);
    const day = dayPositions(j, "2026-10-03").get(a.id)!;
    expect(day.buyQuantity).toBe(200);
    expect(day.sellQuantity).toBe(200);
    expect(j.positions[0].quantity).toBe(0);
  });

  it("keeps an open position's average price", () => {
    const { s, trade } = setup();
    const a = s.investment("ITC", "delivery");
    trade(a.id, "buy", 10, 400, "10:00");
    trade(a.id, "buy", 30, 420, "11:00");
    const pos = buildJournal(s.book, s.ledger).positions[0];
    expect(pos.quantity).toBe(40);
    expect(pos.avgPriceMinor).toBe(rs(415));
  });
});

describe("Zerodha charges", () => {
  it("matches the contract note for an intraday round trip of ₹1,00,000", () => {
    const buy = zerodhaCharges({ product: "intraday", side: "buy", valueMinor: rs(100_000) });
    const sell = zerodhaCharges({ product: "intraday", side: "sell", valueMinor: rs(100_000) });
    expect(buy).toMatchObject({ brokerage: 2000, stt: 0, exchange: 307, sebi: 10, gst: 417, stamp: 300, dp: 0 });
    expect(sell).toMatchObject({ brokerage: 2000, stt: 2500, stamp: 0 });
    expect(buy.total + sell.total).toBe(rs(82.68));
  });

  it("charges delivery STT both ways and the DP charge once a day", () => {
    const sell = zerodhaCharges({ product: "delivery", side: "sell", valueMinor: rs(50_000) });
    expect(sell).toMatchObject({ brokerage: 0, stt: 5000, dp: 1534 });
    expect(zerodhaCharges({ product: "delivery", side: "sell", valueMinor: rs(50_000), dpAlreadyCharged: true }).dp).toBe(0);
  });
});
