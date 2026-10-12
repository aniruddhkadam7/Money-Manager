import { describe, expect, it } from "vitest";
import { parseAmountToMinor } from "@/lib/domain/money";

describe("parseAmountToMinor", () => {
  it("reads rupees with commas, a symbol and paise", () => {
    expect(parseAmountToMinor("1,250.50")).toBe(125050);
    expect(parseAmountToMinor("₹ 99.9")).toBe(9990);
  });

  it("refuses zero unless asked to allow it (an investment can be worth nothing)", () => {
    expect(parseAmountToMinor("0")).toBeNull();
    expect(parseAmountToMinor("0.00")).toBeNull();
    expect(parseAmountToMinor("0", true)).toBe(0);
    expect(parseAmountToMinor("", true)).toBeNull();
    expect(parseAmountToMinor("-5", true)).toBeNull();
  });
});
