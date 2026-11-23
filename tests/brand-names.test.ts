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

describe("Razorpay", () => {
  it("shows Razorpay's logo for a payment naming only it, and the shop's when the line names one", async () => {
    const { brandFor } = await import("@/lib/finance/brands");
    expect(brandFor("UPI/RAZORPAY PAYMENTS/123456")?.slug).toBe("razorpay");
    expect(brandFor("rzp*merchant 4421")?.slug).toBe("razorpay");
    expect(brandFor("RAZORPAY*SWIGGY")?.slug).toBe("swiggyapp");
  });
});

describe("CRED", () => {
  it("is found however the bank prints it, but a shop paid via CRED stays the shop", async () => {
    const { paymentAppFor } = await import("@/lib/finance/brands");
    for (const t of ["CRED", "UPI/CRED/YESB/123456789012/payment on CRED", "UPI/Dreamplug Serv/UTIB/663322393495/payment on C", "cred.club"]) {
      expect(brandFor(t)?.slug).toBe("cred");
      expect(paymentAppFor(t)?.slug).toBe("cred");
    }
    expect(brandFor("UPI/SWIGGY/YESB/123456789012/Paid via CRED")?.slug).toBe("swiggyapp");
    expect(brandFor("UPI/RAJESH KUMAR/YESB/123456789012/Paid via CRED")).toBeNull();
    expect(brandFor("NEFT/HDFC CREDIT CARD/BILL PAYMENT")).toBeNull();
    expect(paymentAppFor("Credit card bill")).toBeNull();
  });
});
