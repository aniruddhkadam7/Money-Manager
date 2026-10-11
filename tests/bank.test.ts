import { describe, expect, it } from "vitest";
import { readBank } from "@/lib/statements/bank";

// Laid out like a Kotak statement: the logo is a picture, so the name only appears in the footer.
const kotakPage = [
  "Account Statement",
  "10 Oct 2026 - 10 Oct 2026",
  "TEST CUSTOMER",
  "CRN xxxxxx123",
  "MICR 411485000 IFSC Code KKBK0000001",
  "Account No. 1234562018",
  "# Date Description Chq/Ref. No. Withdrawal (Dr.) Deposit (Cr.) Balance",
  "- - Opening Balance - - - 29,446.31",
  "1 10 Oct 2026 UPI/Amazon Pay on /UTIB/664930347045/Paid UPI-628376627001 954.35 28,491.96",
  "via CRE",
  "2 10 Oct 2026 UPI/FLIPKART UPI-628378859302 1,601.00 26,890.96",
  "PAYME/HDFC/664927360573/UPIIntent",
  "3 10 Oct 2026 NEFT CR-HDFC0000001-ACME 85,000.00 1,11,890.96",
  "zomato@hdfcbank",
];

describe("which bank a statement is from", () => {
  it("goes by the statement's own IFSC, whatever banks its payments mention", () => {
    expect(readBank(kotakPage)).toBe("Kotak Mahindra Bank");
  });

  it("goes by the bank's full name in the footer when there's no IFSC", () => {
    const noIfsc = kotakPage.filter((l) => !l.includes("IFSC"));
    expect(readBank(noIfsc)).toBeUndefined();
    expect(readBank([...noIfsc, "Any discrepancy should be brought to the notice of Kotak Mahindra Bank Ltd.", "www.kotak.bank.in"])).toBe("Kotak Mahindra Bank");
  });

  it("never takes a bank from payment lines, UPI handles or a bare code", () => {
    expect(readBank(["Account statement", "HDFC", "UPI ref to merchant@okhdfcbank", "PAYME/HDFC/664927360573/UPIIntent", "NEFT CR-HDFC0000001-ACME"])).toBeUndefined();
    expect(readBank(["Account statement", "HDFC Life premium due", "ICICI Prudential"])).toBeUndefined();
  });

  it("says nothing when two banks are equally likely", () => {
    expect(readBank(["HDFC Bank", "Axis Bank"])).toBeUndefined();
  });

  it("reads the usual headers", () => {
    expect(readBank(["HDFC BANK LIMITED", "Statement of account"])).toBe("HDFC Bank");
    expect(readBank(["STATE BANK OF INDIA", "Account Statement"])).toBe("State Bank of India");
    expect(readBank(["KOTAK MAHINDRA BANK - ACCOUNT STATEMENT"])).toBe("Kotak Mahindra Bank");
    expect(readBank(["Statement", "IFSC: HDFC0001234"])).toBe("HDFC Bank");
  });
});
