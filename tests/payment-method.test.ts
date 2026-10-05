import { describe, expect, it } from "vitest";
import { makeDescriber } from "@/lib/finance/describe";
import { methodFromNarration } from "@/lib/finance/payment-method";
import { rs, startingScenario } from "./helpers";

describe("how a payment was made", () => {
  it.each([
    ["UPI/RAVINDRA KASHI/BARB/658320061969/Paid via CRE", "UPI"],
    ["NEFT CR-HDFC0000001-ACME TECHNOLOGIES-SALARY", "NEFT"],
    ["IMPS/P2A/123456/RAHUL", "IMPS"],
    ["POS 4321XXXX DMART PUNE", "Card"],
    ["ATM WDL 12345 BANER", "ATM"],
    ["NACH/BAJAJ FINANCE/EMI", "Auto-debit"],
    ["rahul.sharma@oksbi payment", "UPI"],
    ["Int.Pd:8250712018:01-07-2026 to 30-09-2026", null],
  ])("%s -> %s", (text, method) => {
    expect(methodFromNarration(text)).toBe(method);
  });

  it("entries say how they were paid and from which account, not just the account", () => {
    const { s, hdfc } = startingScenario();
    const card = s.account({ name: "HDFC Credit Card", type: "credit_card" });
    const source = (narration: string) => [{ kind: "statement" as const, importId: "i", rowId: `r-${narration}`, filename: "f", line: 1, role: "created" as const, narration }];
    const upi = s.ok({ type: "expense", date: "2026-09-01", accountId: hdfc.id, amountMinor: rs(70), categoryId: "food", sources: source("UPI/KAI AS MANDAL Restaurants/YESB/123/Paid") });
    const swipe = s.ok({ type: "expense", date: "2026-09-02", accountId: card.id, amountMinor: rs(500), categoryId: "shopping" });
    const typed = s.ok({ type: "expense", date: "2026-09-03", accountId: hdfc.id, amountMinor: rs(40), categoryId: "food" });
    const d = makeDescriber(s.book, (id) => (id === "food" ? "Food" : "Shopping"));
    expect(d.subtitle(upi)).toBe("Food · UPI from HDFC");
    expect(d.subtitle(swipe)).toBe("Shopping · from HDFC Credit Card");
    expect(d.subtitle(typed)).toBe("Food · from HDFC");
  });
});

describe("spending on credit cards", () => {
  it("counts purchases on the card, less refunds onto it, and bill payments separately", async () => {
    const { cardSpending } = await import("@/lib/finance/card-spend");
    const { s, hdfc } = startingScenario();
    const card = s.account({ name: "HDFC Credit Card", type: "credit_card" });
    s.ok({ type: "expense", date: "2026-09-02", accountId: card.id, amountMinor: rs(1_500), categoryId: "petrol" });
    s.ok({ type: "expense", date: "2026-09-05", accountId: card.id, amountMinor: rs(800), categoryId: "food" });
    s.ok({ type: "income", date: "2026-09-08", accountId: card.id, amountMinor: rs(300), categoryId: "refund" });
    s.ok({ type: "expense", date: "2026-09-09", accountId: hdfc.id, amountMinor: rs(999), categoryId: "food" }); // not on the card
    s.ok({ type: "transfer", date: "2026-09-20", fromAccountId: hdfc.id, toAccountId: card.id, amountMinor: rs(2_000) });
    s.ok({ type: "expense", date: "2026-10-01", accountId: card.id, amountMinor: rs(50), categoryId: "food" }); // next month

    const sep = cardSpending(s.book, "2026-09-01", "2026-09-30");
    expect(sep.spentMinor).toBe(rs(2_000));
    expect(sep.paidMinor).toBe(rs(2_000));
    expect(sep.byCard).toHaveLength(1);
  });
});

describe("bill payments recorded as spending", () => {
  it("are found so they can be turned into payments to the card", async () => {
    const { billPaymentsRecordedAsSpending } = await import("@/lib/finance/card-spend");
    const { s, hdfc } = startingScenario();
    s.account({ name: "Credit card", type: "credit_card" });
    const cred = s.ok({ type: "expense", date: "2026-09-24", accountId: hdfc.id, amountMinor: rs(13_776), categoryId: "other", description: "Dreamplug Serv" });
    s.ok({ type: "expense", date: "2026-09-25", accountId: hdfc.id, amountMinor: rs(70), categoryId: "food", description: "KAI AS MANDAL Restaurants" });
    expect(billPaymentsRecordedAsSpending(s.book).map((e) => e.id)).toEqual([cred.id]);
  });
});

describe("where spending was paid from", () => {
  it("bank account, credit card or cash, by the account only; adds up to Spent", async () => {
    const { spendByAccount } = await import("@/lib/finance/spend-by-method");
    const { s, hdfc } = startingScenario();
    const card = s.account({ name: "Kotak Credit Card", type: "credit_card" });
    const cash = s.account({ name: "Cash", type: "cash" });
    s.ok({ type: "expense", date: "2026-09-02", accountId: card.id, amountMinor: rs(3_000), categoryId: "shopping" });
    s.ok({ type: "expense", date: "2026-09-03", accountId: hdfc.id, amountMinor: rs(1_200), categoryId: "grocery" }); // debit card
    s.ok({ type: "expense", date: "2026-09-04", accountId: hdfc.id, amountMinor: rs(70), categoryId: "food" }); // UPI
    s.ok({ type: "expense", date: "2026-09-05", accountId: cash.id, amountMinor: rs(50), categoryId: "food" });
    s.ok({ type: "income", date: "2026-09-08", accountId: card.id, amountMinor: rs(300), categoryId: "refund" });
    s.ok({ type: "transfer", date: "2026-09-20", fromAccountId: hdfc.id, toAccountId: card.id, amountMinor: rs(3_000) }); // bill payment: not spending

    const split = spendByAccount(s.book, "2026-09-01", "2026-09-30");
    expect(Object.fromEntries(split.parts.map((p) => [p.from, p.amountMinor]))).toEqual({ bank: rs(1_270), credit_card: rs(3_000), cash: rs(50) });
    expect(split.totalMinor).toBe(s.report("2026-09-01", "2026-09-30").expensesMinor);
  });
});
