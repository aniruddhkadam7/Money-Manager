import { describe, expect, it } from "vitest";
import { deleteAccount, deleteEvent, restoreEvent } from "@/lib/finance/book-ops";
import { rs, startingScenario } from "./helpers";

describe("deleted entries", () => {
  it("are kept, count for nothing, and go back exactly as they were", () => {
    const { s, hdfc } = startingScenario();
    const spend = s.ok({ type: "expense", date: "2026-10-01", accountId: hdfc.id, amountMinor: rs(500), categoryId: "food" });
    const before = s.state().netWorthMinor;

    const del = deleteEvent(s.book, spend.id, s.clock);
    expect(del.ok).toBe(true);
    if (!del.ok) return;
    expect(del.value.events.some((e) => e.id === spend.id)).toBe(false);
    expect(del.value.deleted).toEqual([{ event: spend, deletedAt: expect.any(String) }]);
    s.book = del.value;
    expect(s.state().netWorthMinor).toBe(before + rs(500));

    const back = restoreEvent(s.book, spend);
    expect(back.ok && back.value.events.find((e) => e.id === spend.id)).toEqual(spend);
    expect(back.ok && back.value.deleted).toEqual([]);
  });

  it("include the entries deleted along with their account", () => {
    const { s } = startingScenario();
    const wallet = s.account({ name: "Wallet", type: "cash", openingBalanceMinor: rs(1_000) });
    const spend = s.ok({ type: "expense", date: "2026-10-01", accountId: wallet.id, amountMinor: rs(100), categoryId: "food" });
    const r = deleteAccount(s.book, wallet.id, { withEntries: true });
    expect(r.ok && r.value.deleted?.map((d) => d.event.id)).toEqual([spend.id]);
  });
});
