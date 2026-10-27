import { describe, expect, it } from "vitest";
import { brandFor } from "@/lib/finance/brands";
import { canonicalShopName } from "@/lib/finance/describe";

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
    expect(brandFor("GOD DDY Services")?.slug).toBe("godaddy");
  });

  it("finds Flipkart however the card or the bank prints it", () => {
    for (const t of ["Fli Kart", "FLIPKART PAYME", "Flipkart Payme", "UPI/123/FLIPKART INTERNET PVT/ybl", "FLI KART"]) {
      expect(brandFor(t)?.slug).toBe("flipkart");
    }
    expect(brandFor("Flipkar")?.slug).toBe("flipkart");
    expect(canonicalShopName("Fli Kart")).toBe("Flipkart");
    expect(canonicalShopName("Flipkart Payme")).toBe("Flipkart");
    expect(canonicalShopName("Swiggy Instamart")).toBeNull();
    expect(canonicalShopName("Netflix")).toBeNull();
  });

  it("finds Tata 1mg however it is written, and not a dosage", () => {
    expect(brandFor("1mg")?.slug).toBe("1mg");
    expect(brandFor("UPI/403821907312/1MG TECHNOLOGIES/okaxis")?.slug).toBe("1mg");
    expect(brandFor("Tata 1mg")?.slug).toBe("1mg");
    expect(brandFor("Tata 1 mg")?.slug).toBe("1mg");
    expect(brandFor("Paracetamol 500 mg")).toBeNull();
    expect(brandFor("Vitamin 21mg")).toBeNull();
  });
});
