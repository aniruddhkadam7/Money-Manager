import { describe, expect, it } from "vitest";
import { updateAccount } from "@/lib/finance/book-ops";
import { rs, startingScenario } from "./helpers";

describe("stock trade styles", () => {
  it("keeps one company bought intraday and held long term as separate holdings", () => {
    const { s } = startingScenario();
    const intraday = s.investment("Reliance", "intraday");
    const longTerm = s.investment("Reliance", "delivery");
    expect(intraday.id).not.toBe(longTerm.id);
    expect(longTerm.style).toBe("delivery");
    // Buying the same company in the same style again adds to that holding.
    expect(s.investment("reliance", "intraday").id).toBe(intraday.id);
  });

  it("lets two styles of one company share its name, but not two accounts of other kinds", () => {
    const { s, hdfc } = startingScenario();
    const intraday = s.investment("Reliance", "intraday");
    s.investment("Reliance", "delivery");
    expect(updateAccount(s.book, intraday.id, { openingBalanceMinor: 0 }).ok).toBe(true);
    expect(updateAccount(s.book, hdfc.id, { name: "Reliance" }).ok).toBe(false);
  });

  it("adds up the profit booked by selling an amount-based investment, even once it is sold out", () => {
    const { s, hdfc } = startingScenario();
    const tcs = s.investment("Gold fund");
    s.ok({ type: "invest", date: "2026-10-01", fromAccountId: hdfc.id, holdingId: tcs.id, amountMinor: rs(10_000) });
    s.ok({ type: "sell_investment", date: "2026-10-01", holdingId: tcs.id, toAccountId: hdfc.id, proceedsMinor: rs(10_400) });
    s.ok({ type: "invest", date: "2026-10-02", fromAccountId: hdfc.id, holdingId: tcs.id, amountMinor: rs(5_000) });
    s.ok({ type: "sell_investment", date: "2026-10-02", holdingId: tcs.id, toAccountId: hdfc.id, proceedsMinor: rs(4_900) });

    const h = s.state().investments.holdings.find((x) => x.account.id === tcs.id)!;
    expect(h.valueMinor).toBe(0);
    expect(h.costBasisMinor).toBe(0);
    expect(h.realizedMinor).toBe(rs(300));
  });
});
