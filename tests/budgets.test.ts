import { describe, expect, it } from "vitest";
import { budgetLines } from "@/lib/finance/budgets";

describe("budgetLines", () => {
  const spent = [
    { categoryId: "food", amountMinor: 85000 },
    { categoryId: "travel", amountMinor: 120000 },
    { categoryId: "health", amountMinor: 10000 },
  ];

  it("grades each budget: fine, near from 80%, over past the limit", () => {
    const lines = budgetLines({ food: 100000, travel: 100000, health: 100000, rent: 500000 }, spent);
    expect(lines.map((l) => [l.categoryId, l.state])).toEqual([
      ["travel", "over"],
      ["food", "near"],
      ["health", "ok"],
      ["rent", "ok"],
    ]);
  });

  it("exactly 80% is near, exactly on budget is not over", () => {
    expect(budgetLines({ a: 100 }, [{ categoryId: "a", amountMinor: 80 }])[0].state).toBe("near");
    expect(budgetLines({ a: 100 }, [{ categoryId: "a", amountMinor: 100 }])[0].state).toBe("near");
  });

  it("ignores budgets that are zero", () => {
    expect(budgetLines({ a: 0 }, [])).toEqual([]);
  });
});
