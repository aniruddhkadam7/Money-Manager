import { describe, expect, it } from "vitest";
import { readCardBill } from "@/lib/statements/card-bill";

describe("reading the bill a card statement asks you to pay", () => {
  it("label-then-value layout", () => {
    const text = "Statement Date 23/09/2026 Payment Due Date 13/10/2026 Total Amount Due ₹3,408.96 Minimum Amount Due ₹170.45 Credit Limit ₹1,00,000.00";
    expect(readCardBill(text)).toEqual({ statementDate: "2026-09-23", dueDate: "2026-10-13", totalDueMinor: 340_896, minimumDueMinor: 17_045 });
  });

  it("header row with the values underneath", () => {
    const text = "Statement Date Payment Due Date Total Amount Due Minimum Amount Due 23-Sep-2026 13-Oct-2026 3,408.96 170.45 Card No 4375XXXXXXXX7671";
    expect(readCardBill(text)).toEqual({ statementDate: "2026-09-23", dueDate: "2026-10-13", totalDueMinor: 340_896, minimumDueMinor: 17_045 });
  });

  it("nothing to read on a bank statement", () => {
    expect(readCardBill("UPI/RAVINDRA KASHI/BARB/658320061969/Paid via CRE 125.00")).toBeUndefined();
  });
});

describe("where a card's bill stands", () => {
  it("two statements: the first bill paid in full, the second still to pay, with spending since", async () => {
    const { cardBillStatus } = await import("@/lib/finance/card-bill-status");
    const { rs, startingScenario } = await import("./helpers");
    const { s, hdfc } = startingScenario();
    const card = s.account({ name: "Kotak Credit Card", type: "credit_card" });
    s.ok({ type: "expense", date: "2026-08-10", accountId: card.id, amountMinor: rs(13_776.11), categoryId: "food" }); // cycle 1
    s.ok({ type: "transfer", date: "2026-09-05", fromAccountId: hdfc.id, toAccountId: card.id, amountMinor: rs(13_776.11) }); // paid it
    s.ok({ type: "expense", date: "2026-09-12", accountId: card.id, amountMinor: rs(3_408.96), categoryId: "food" }); // cycle 2
    s.ok({ type: "expense", date: "2026-09-28", accountId: card.id, amountMinor: rs(500), categoryId: "petrol" }); // after statement 2

    const status = cardBillStatus(s.book, card.id, [
      { statementDate: "2026-08-25", dueDate: "2026-09-14", totalDueMinor: rs(13_776.11) },
      { statementDate: "2026-09-23", dueDate: "2026-10-13", totalDueMinor: rs(3_408.96), minimumDueMinor: rs(170.45) },
    ])!;

    expect(status.previous).toMatchObject({ paidInFull: true, paidMinor: rs(13_776.11) });
    expect(status.latest).toMatchObject({ billMinor: rs(3_408.96), dueDate: "2026-10-13" });
    expect(status.remainingMinor).toBe(rs(3_408.96));
    // A statement whose bill couldn't be read adds nothing: no estimates.
    expect(cardBillStatus(s.book, card.id, [{}])).toBeNull();
  });
});
