import { describe, expect, it } from "vitest";
import { counterpartyKeyOf, detectMode, looksLikePerson, normalizeDescription } from "@/lib/statements/normalize";

describe("normalizing bank narrations", () => {
  it("recognises the same merchant across different bank formats", () => {
    const variants = [
      "UPI/403821907312/SWIGGY/swiggyupi@icici",
      "UPI-SWIGGY-swiggyupi@icici-403821907312-UPI",
      "SWIGGY INDIA PVT LTD",
      "UPI/DR/403821907312/Swiggy/ICIC/swiggy@icici/Payment",
    ];
    for (const v of variants) expect(normalizeDescription(v).counterpartyKey, v).toBe("swiggy");
  });

  it("pulls out mode, reference and VPA without losing them", () => {
    const n = normalizeDescription("UPI/403821907312/SWIGGY/swiggyupi@icici");
    expect(n.mode).toBe("UPI");
    expect(n.reference).toBe("403821907312");
    expect(n.vpa).toBe("swiggyupi@icici");
    expect(n.counterparty).toBe("Swiggy");
  });

  it("keeps a person's full name together", () => {
    const n = normalizeDescription("UPI/CR/982341556677/RAHUL SHARMA/HDFC/rahul.sharma@okhdfcbank/Payment");
    expect(n.counterparty).toBe("Rahul Sharma");
    expect(n.counterpartyKey).toBe("rahul sharma");
    expect(n.reference).toBe("982341556677");
  });

  it("handles NEFT and IMPS narrations", () => {
    expect(normalizeDescription("NEFT-N252260123456789-ACME TECHNOLOGIES PVT LTD-SALARY-SEP").counterpartyKey).toBe("acme technologies");
    expect(normalizeDescription("IMPS-526012345678-AMIT KUMAR-HDFC-XXXXXXXX1234-Rent").counterpartyKey).toBe("amit kumar");
    expect(normalizeDescription("NEFT CR-HDFC0001234-ACME TECHNOLOGIES PVT LTD-SALARY").mode).toBe("NEFT");
  });

  it("handles card (POS) and ATM lines", () => {
    const pos = normalizeDescription("POS 4012XXXXXXXX1234 BIGBASKET");
    expect(pos.mode).toBe("POS");
    expect(pos.counterpartyKey).toBe("bigbasket");
    const atm = normalizeDescription("ATM WDL 5416 MG ROAD BANGALORE");
    expect(atm.mode).toBe("ATM");
    expect(atm.text.length).toBeGreaterThan(0);
  });

  it("falls back to cleaned text when no counterparty can be found", () => {
    const n = normalizeDescription("ATM WDL");
    expect(n.counterpartyKey).toBe("");
    expect(n.text).toBe("atm wdl");
  });

  it("is stable on whitespace and case, and never throws", () => {
    expect(normalizeDescription("  UPI/1/  swiggy  ").counterpartyKey).toBe("swiggy");
    for (const s of ["", "   ", "/", "---", "123456789012", "@", "X".repeat(500)]) {
      expect(() => normalizeDescription(s)).not.toThrow();
    }
  });

  it("detects the payment mode", () => {
    expect(detectMode("UPI/123/X")).toBe("UPI");
    expect(detectMode("Cheque deposit CHQ 123")).toBe("CHQ");
    expect(detectMode("Amazon Pay purchase via UPI")).toBe("UPI");
    expect(detectMode("Salary")).toBeNull();
  });

  it("strips company suffixes only in the key", () => {
    expect(counterpartyKeyOf("Swiggy India Pvt Ltd")).toBe("swiggy");
    expect(counterpartyKeyOf("Zomato Limited")).toBe("zomato");
    expect(counterpartyKeyOf("Rahul Sharma")).toBe("rahul sharma");
  });
});

describe("person vs business", () => {
  it("treats short alphabetic names as people", () => {
    expect(looksLikePerson("rahul sharma", null)).toBe(true);
    expect(looksLikePerson("rahul", "rahul123@okhdfcbank")).toBe(true);
  });
  it("does not treat businesses as people", () => {
    expect(looksLikePerson("sharma medical store", null)).toBe(false);
    expect(looksLikePerson("big bazaar", null)).toBe(false);
    expect(looksLikePerson("", null)).toBe(false);
    expect(looksLikePerson("swiggy", "swiggyupi@icici")).toBe(true); // a lone brand word is ambiguous: rules (not this) decide it
  });
});
