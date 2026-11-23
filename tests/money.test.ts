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

describe("amounts typed with commas", () => {
  it("groups the Indian way as you type", async () => {
    const { groupAmountInput } = await import("@/lib/domain/money");
    expect(groupAmountInput("100000")).toBe("1,00,000");
    expect(groupAmountInput("1,00,0000")).toBe("10,00,000");
    expect(groupAmountInput("999")).toBe("999");
    expect(groupAmountInput("1250.5")).toBe("1,250.5");
    expect(groupAmountInput("1250.567")).toBe("1,250.56");
    expect(groupAmountInput("12.3.4")).toBe("12.34");
    expect(groupAmountInput(".5")).toBe("0.5");
    expect(groupAmountInput("0005")).toBe("5");
    expect(groupAmountInput("₹ 12a34")).toBe("1,234");
    expect(groupAmountInput("")).toBe("");
  });
  it("prefills with commas, and reads them back", async () => {
    const { minorToInputString, parseAmountToMinor } = await import("@/lib/domain/money");
    expect(minorToInputString(1_00_000_00)).toBe("1,00,000");
    expect(minorToInputString(1_250_50)).toBe("1,250.50");
    expect(parseAmountToMinor(minorToInputString(12_34_567_89))).toBe(12_34_567_89);
  });
});
