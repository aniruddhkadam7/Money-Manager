import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES, categoryLabel, familyIds, orderWithChildren, rollUpByParent } from "@/lib/domain/categories";
import type { Category } from "@/lib/domain/types";

const hair: Category = { id: "custom-hair", name: "Hair care", color: "#22c55e", icon: "health", isDefault: false, parentId: "health" };
const list = [...DEFAULT_CATEGORIES, hair];

describe("subcategories", () => {
  it("puts a subcategory right after its parent", () => {
    const ordered = orderWithChildren(list).map((c) => c.id);
    expect(ordered[ordered.indexOf("health") + 1]).toBe("custom-hair");
    expect(ordered).toHaveLength(list.length);
  });

  it("labels a subcategory with its parent", () => {
    expect(categoryLabel(hair, list)).toBe("Health › Hair care");
    expect(categoryLabel(DEFAULT_CATEGORIES[0], list)).toBe("Food");
  });

  it("rolls subcategory spending into the parent, keeping the subcategory rows", () => {
    const rows = [
      { categoryId: "food", amountMinor: 500 },
      { categoryId: "health", amountMinor: 200 },
      { categoryId: "custom-hair", amountMinor: 400 },
    ];
    const rolled = rollUpByParent(rows, list);
    expect(rolled.map((r) => [r.categoryId, r.amountMinor])).toEqual([["health", 600], ["food", 500]]);
    expect(rolled[0].children.map((c) => c.categoryId)).toEqual(["custom-hair"]);
    expect(rolled.reduce((t, r) => t + r.amountMinor, 0)).toBe(1100);
  });

  it("shows the parent even when only the subcategory has spending", () => {
    const rolled = rollUpByParent([{ categoryId: "custom-hair", amountMinor: 400 }], list);
    expect(rolled.map((r) => [r.categoryId, r.amountMinor])).toEqual([["health", 400]]);
  });

  it("a parent's family includes its subcategories", () => {
    expect(familyIds("health", list)).toEqual(["health", "custom-hair"]);
    expect(familyIds("food", list)).toEqual(["food"]);
  });
});
