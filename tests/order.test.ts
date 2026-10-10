import { describe, expect, it } from "vitest";
import { chronological } from "@/lib/finance/order";
import type { FinancialEvent } from "@/lib/finance/types";

const at = "2026-10-10T10:00:00.000Z";
function entry(id: string, date: string, line: number): FinancialEvent {
  return {
    id, date, type: "expense", accountId: "a", amountMinor: 100, categoryId: "c", createdAt: at, updatedAt: at,
    sources: [{ kind: "statement", importId: "imp", rowId: id, filename: "s.pdf", line, role: "created" }],
  } as FinancialEvent;
}

describe("entries in statement order", () => {
  it("keeps same-day entries in the order of an oldest-first statement", () => {
    const events = [entry("c", "2026-10-10", 3), entry("a", "2026-10-09", 1), entry("d", "2026-10-10", 4), entry("b", "2026-10-10", 2)];
    expect([...events].sort(chronological(events)).map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("reads a newest-first statement the other way round", () => {
    const events = [entry("d", "2026-10-10", 1), entry("c", "2026-10-10", 2), entry("b", "2026-10-10", 3), entry("a", "2026-10-09", 4)];
    expect([...events].sort(chronological(events)).map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
  });
});
