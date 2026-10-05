import { describe, expect, it } from "vitest";
import { findSimilar, retype } from "@/lib/finance/similar";
import { rs, startingScenario } from "./helpers";

describe("similar entries", () => {
  it("offers other entries from the same merchant, whatever the narration", () => {
    const { s, hdfc } = startingScenario();
    const add = (date: string, description: string, categoryId = "other") =>
      s.ok({ type: "expense", date, description, accountId: hdfc.id, amountMinor: rs(1384), categoryId });
    add("2026-09-20", "OYO Rooms", "travel");
    add("2026-09-21", "OYO Rooms");
    add("2026-09-22", "UPI-OYO ROOMS-123");
    add("2026-09-23", "Swiggy", "food");
    const edited = s.book.events[0];
    const found = findSimilar(s.book, edited);
    // the second entry (same name) is offered; the third has a different key; Swiggy is unrelated
    expect(found.map((m) => m.event.date)).toEqual(["2026-09-21"]);
    expect(found[0].draft).toMatchObject({ type: "expense", categoryId: "travel", amountMinor: rs(1384) });
  });

  it("carries the new person and kind to the others, keeping their own amount and date", () => {
    const { s, hdfc } = startingScenario();
    const rahul = s.person("Rahul");
    s.ok({ type: "reimbursable_expense", date: "2026-09-20", description: "OYO Rooms", accountId: hdfc.id, amountMinor: rs(1384), categoryId: "travel", personId: rahul.id });
    s.ok({ type: "expense", date: "2026-09-27", description: "OYO Rooms", accountId: hdfc.id, amountMinor: rs(1402), categoryId: "other" });
    const found = findSimilar(s.book, s.book.events[0]);
    expect(found).toHaveLength(1);
    expect(found[0].draft).toMatchObject({ type: "reimbursable_expense", personId: rahul.id, categoryId: "travel", amountMinor: rs(1402), date: "2026-09-27" });
  });

  it("matches by person too, and never flips the direction of the money", () => {
    const { s, hdfc } = startingScenario();
    const vicky = s.person("Vicky");
    s.ok({ type: "borrow", date: "2026-09-10", personId: vicky.id, accountId: hdfc.id, amountMinor: rs(15000) });
    s.ok({ type: "lend", date: "2026-09-12", personId: vicky.id, accountId: hdfc.id, amountMinor: rs(500) }); // money out
    s.ok({ type: "borrow", date: "2026-09-14", personId: vicky.id, accountId: hdfc.id, amountMinor: rs(10000), description: "x" });
    const edited = s.book.events[0];
    // already a borrow with the same person: nothing to change; the lend is the other direction
    expect(findSimilar(s.book, edited)).toEqual([]);
    expect(retype(s.book.events[1], edited)).toBeNull();
  });
});
