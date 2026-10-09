import { describe, expect, it } from "vitest";
import { readCardNumber } from "@/lib/statements/mask";

describe("readCardNumber", () => {
  it("reads the last four of a masked card number", () => {
    expect(readCardNumber("Card No: 4893 77XX XXXX 4576 Statement Date 25/08/2026")).toBe("4576");
    expect(readCardNumber("Credit Card Number XXXX XXXX XXXX 1234")).toBe("1234");
    expect(readCardNumber("Card 5241********9012 Payment Due")).toBe("9012");
    expect(readCardNumber("Card Number: 4375-51XX-XXXX-7788")).toBe("7788");
  });
  it("reads an Amex-shaped number", () => {
    expect(readCardNumber("Card Number 3782 XXXXXX X1005")).toBe("1005");
  });
  it("ignores numbers that aren't a masked card number", () => {
    expect(readCardNumber("Customer ID 94XXXXXXXXXXXX76")).toBeUndefined();
    expect(readCardNumber("Account 50100123456789 Ref 1234567890123456")).toBeUndefined();
    expect(readCardNumber("Total Dues 12,345.00")).toBeUndefined();
  });
});
