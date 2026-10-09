import { describe, expect, it } from "vitest";
import { brandFor } from "@/lib/finance/brands";

describe("recognising companies in names", () => {
  it("finds EY by its name or Ernst & Young, not inside other words", () => {
    expect(brandFor("EY")?.slug).toBe("ey");
    expect(brandFor("EY LLP")?.slug).toBe("ey");
    expect(brandFor("NEFT HSBCN28094676728 ERNST YOUNG LLP HS")?.slug).toBe("ey");
    expect(brandFor("PAN EY TEA STALL Restaurants")?.slug).not.toBe("ey");
    expect(brandFor("Pandey Stores")).toBeNull();
  });

  it("finds OYO, GitHub and GoDaddy the way banks print them", () => {
    expect(brandFor("OYO Rooms")?.slug).toBe("oyo");
    expect(brandFor("PCI/6496/GITHUB* CARD VERIFY/+18774484081026/18:34")?.slug).toBe("github");
    expect(brandFor("DNH*GODADDY#3456789")?.slug).toBe("godaddy");
  });
});
