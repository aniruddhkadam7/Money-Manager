import { describe, expect, it } from "vitest";
import { readCardBill } from "@/lib/statements/card-bill";
import { DEFAULT_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from "@/lib/domain/categories";
import type { Book } from "@/lib/finance/types";
import { checkCardBill, readAsCardStatement, recheckCardImports } from "@/lib/statements/pipeline";
import { reconcile } from "@/lib/statements/reconcile";
import { emptyImportStore, type ImportRecord, type ParsedStatement, type StatementRow } from "@/lib/statements/types";

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

describe("which way an unmarked card line goes", () => {
  const read = (rawDescription: string) => {
    const row = { rawDescription, debitMinor: 1500, creditMinor: 0, confidence: 1, warnings: ["Direction could not be determined"] };
    readAsCardStatement({ rows: [row] });
    return row.creditMinor > 0 ? "credit" : "debit";
  };

  it("a merchant name cut off at CR is still a purchase", () => {
    expect(read("UPI-K-660110970898-STR WBERRY DELIGH CR Restaurants")).toBe("debit");
  });

  it("payments, refunds and a trailing Cr are credits", () => {
    expect(read("PAYMENT RECEIVED - THANK YOU")).toBe("credit");
    expect(read("REFUND AMAZON")).toBe("credit");
    expect(read("SWIGGY 450.00 Cr")).toBe("credit");
  });
});

describe("a card statement checked against its bill", () => {
  const statement = (lines: [string, number, number][]) =>
    ({
      parser: "test",
      rows: lines.map(([rawDescription, debitMinor, creditMinor]) => ({ date: "2026-08-10", rawDescription, debitMinor, creditMinor, confidence: 1, warnings: [] })),
    }) as unknown as ParsedStatement;
  const check = (parsed: ParsedStatement, guessed: number[], previousMinor: number, totalDueMinor: number) =>
    checkCardBill(parsed, guessed, { previousMinor, previousFrom: "your entries", totalDueMinor }, reconcile(parsed));

  it("adds up: verified, nothing to look at", () => {
    const r = check(statement([["SWIGGY", 50_000, 0], ["PAYMENT RECEIVED", 0, 20_000]]), [0, 1], 20_000, 50_000);
    expect(r).toMatchObject({ ok: true, verifiable: true, differenceMinor: 0 });
    expect(r.issues.some((i) => i.kind === "no_totals")).toBe(false);
  });

  it("a purchase read as a refund is turned round (the Aug bill: ₹13,761.11 + ₹15 = ₹13,776.11)", () => {
    const parsed = statement([["GROCERIES", 1_376_111, 0], ["STRAWBERRY", 0, 1_500]]);
    const r = check(parsed, [0, 1], 0, 1_377_611);
    expect(parsed.rows[1]).toMatchObject({ debitMinor: 1_500, creditMinor: 0 });
    expect(r).toMatchObject({ ok: true, totalDebitsMinor: 1_377_611, totalCreditsMinor: 0 });
  });

  it("a line whose direction was printed is never turned round", () => {
    const parsed = statement([["GROCERIES", 1_376_111, 0], ["REFUND", 0, 1_500]]);
    const r = check(parsed, [], 0, 1_377_611);
    expect(parsed.rows[1].creditMinor).toBe(1_500);
    expect(r.ok).toBe(false);
    expect(r.issues.find((i) => i.kind === "balance_mismatch")?.message).toContain("₹30");
  });

  it("two lines that could explain the gap: none is guessed, the import waits for a look", () => {
    const parsed = statement([["A", 0, 1_500], ["B", 0, 1_500], ["C", 10_000, 0]]);
    const r = check(parsed, [0, 1, 2], 0, 10_000);
    expect(parsed.rows.map((x) => x.creditMinor)).toEqual([1_500, 1_500, 0]);
    expect(r.ok).toBe(false);
  });
});

describe("card statements imported before the bill check", () => {
  const card = { id: "card", name: "Credit card", type: "credit_card", openingBalanceMinor: 0, openedOn: "2000-01-01", createdAt: "t" } as const;
  const bank = { ...card, id: "bank", name: "Bank", type: "bank" } as const;
  const row = (id: string, rawDescription: string, direction: "debit" | "credit", amountMinor: number, eventId?: string) =>
    ({ id, importId: "imp", rawDescription, direction, amountMinor, debitMinor: direction === "debit" ? amountMinor : 0, creditMinor: direction === "credit" ? amountMinor : 0, rawData: { line: rawDescription, warnings: [] }, normalizedDescription: rawDescription, normalized: { mode: null, reference: null, vpa: null, counterparty: rawDescription, counterpartyKey: rawDescription.toLowerCase(), text: rawDescription.toLowerCase() }, eventId }) as unknown as StatementRow;
  const setup = () => {
    const book: Book = {
      accounts: [card, bank],
      people: [],
      events: [
        { id: "e1", type: "expense", date: "2026-08-10", accountId: "card", amountMinor: 1_376_111, categoryId: "food", createdAt: "t", updatedAt: "t" },
        { id: "e2", type: "transfer", date: "2026-08-23", description: "STR WBERRY DELIGH CR Restaurants", fromAccountId: "bank", toAccountId: "card", amountMinor: 1_500, createdAt: "t", updatedAt: "t" },
      ],
    };
    const store = {
      ...emptyImportStore(),
      imports: [{ id: "imp", accountId: "card", status: "IMPORTED", periodStart: "2026-07-31", periodEnd: "2026-08-25", cardBill: { totalDueMinor: 1_377_611 } } as ImportRecord],
      rows: [row("r1", "GROCERIES", "debit", 1_376_111, "e1"), row("r2", "UPI-K-660110970898-STR WBERRY DELIGH CR Restaurants", "credit", 1_500, "e2")],
    };
    return { book, store };
  };
  const ctx = { expenseCategories: DEFAULT_CATEGORIES, incomeCategories: DEFAULT_INCOME_CATEGORIES };

  it("the misread line and its entry are put right, once", () => {
    const { book, store } = setup();
    const { store: next, fixes } = recheckCardImports(store, book, ctx);
    expect(next.rows[1]).toMatchObject({ direction: "debit", debitMinor: 1_500, creditMinor: 0 });
    expect(fixes).toEqual([{ eventId: "e2", draft: expect.objectContaining({ type: "expense", accountId: "card", amountMinor: 1_500 }) }]);
    expect(recheckCardImports(next, book, ctx).fixes).toEqual([]);
  });

  it("a statement that already adds up is left alone", () => {
    const { book, store } = setup();
    store.imports[0].cardBill = { totalDueMinor: 1_376_111 - 1_500 };
    const { store: next, fixes } = recheckCardImports(store, book, ctx);
    expect(fixes).toEqual([]);
    expect(next.rows).toEqual(store.rows);
  });
});
