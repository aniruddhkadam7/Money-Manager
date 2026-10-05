import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from "@/lib/domain/categories";
import { defaultAccounts } from "@/lib/finance/migrate";
import type { Book } from "@/lib/finance/types";
import { processStatement, resolveRow, type PipelineEnv } from "@/lib/statements/pipeline";
import { emptyImportStore, type ImportStoreData } from "@/lib/statements/types";
import { nodePdfjs } from "./pdf-helpers";

const categories = { expenseCategories: DEFAULT_CATEGORIES, incomeCategories: DEFAULT_INCOME_CATEGORIES };
const book: Book = { accounts: defaultAccounts("2026-01-01T00:00:00Z"), people: [], events: [] };
let n = 0;
const env = async (): Promise<PipelineEnv> => ({ pdfjs: await nodePdfjs(), now: () => "2026-10-05T10:00:00Z", newId: () => `a${++n}` });
const e = { book, now: "2026-10-05T10:00:00Z" };

const csv = (rows: [string, string, number][], opening: number) => {
  let balance = opening;
  const lines = rows.map(([date, desc, amount]) => {
    balance -= amount;
    return `${date},"${desc}",${amount.toFixed(2)},,${balance.toFixed(2)}`;
  });
  return new TextEncoder().encode(["Date,Narration,Withdrawal,Deposit,Balance", ...lines].join("\n"));
};

async function load(store: ImportStoreData, name: string, rows: [string, string, number][]) {
  const out = await processStatement({ data: csv(rows, 10_000), filename: name, accountId: "account-netbanking", book, store, categories, useAi: false }, await env());
  return out.store;
}

const hotel = (store: ImportStoreData) => store.rows.filter((r) => r.rawDescription.includes("RAVINDRA KASHI"));

describe("“is this name always that?”", () => {
  it("yes: applies to every waiting line in every open statement, and to statements imported later", async () => {
    let store = await load(emptyImportStore(), "aug.csv", [
      ["05/08/2026", "UPI/RAVINDRA KASHI/BARB/658320061969/Paid via CRE", 125],
      ["12/08/2026", "UPI/RAVINDRA KASHI/BARB/658320061970/Paid via CRE", 140],
    ]);
    store = await load(store, "sep.csv", [["03/09/2026", "UPI/RAVINDRA KASHI/BARB/658320061971/Paid via CRE", 160]]);
    const [first] = hotel(store);

    const res = resolveRow(store, first.id, { kind: "classify", eventType: "EXPENSE", category: "Food", scope: "always" }, e);
    expect(res.applied).toBe(2);
    for (const r of hotel(res.store)) {
      expect(r.classification?.category).toBe("Food");
      expect(r.status).toBe("auto");
    }

    const later = await load(res.store, "oct.csv", [["02/10/2026", "UPI/RAVINDRA KASHI/BARB/658320061972/Paid via CRE", 90]]);
    const oct = hotel(later).find((r) => r.transactionDate === "2026-10-02")!;
    expect(oct.classification).toMatchObject({ source: "user_rule", eventType: "EXPENSE", category: "Food" });
    expect(oct.status).toBe("auto");
  });

  it("just this once: settles the line and teaches nothing", async () => {
    const store = await load(emptyImportStore(), "aug.csv", [
      ["05/08/2026", "UPI/RAVINDRA KASHI/BARB/658320061969/Paid via CRE", 125],
      ["12/08/2026", "UPI/RAVINDRA KASHI/BARB/658320061970/Paid via CRE", 140],
    ]);
    const [first, second] = hotel(store);
    const res = resolveRow(store, first.id, { kind: "classify", eventType: "EXPENSE", category: "Food", scope: "once" }, e);
    expect(res.applied).toBe(0);
    expect(res.store.rules).toHaveLength(0);
    expect(res.store.rows.find((r) => r.id === second.id)!.status).toBe("review");
  });
});

describe("waiting lines are re-read with newer rules", () => {
  it("a line left for review is settled once a rule can read it, and decided lines are left alone", async () => {
    const { reclassifyWaiting } = await import("@/lib/statements/pipeline");
    let store = await load(emptyImportStore(), "aug.csv", [["05/08/2026", "UPI/KAI AS MANDAL Restaurants/YESB/123456789012/Paid via", 70]]);
    const line = store.rows[0];
    // Pretend it was read before the rule existed.
    store = { ...store, rows: store.rows.map((r) => ({ ...r, status: "review" as const, classification: { ...r.classification!, category: "Other", confidence: 0.5 } })) };
    const out = reclassifyWaiting(store, book);
    expect(out.changed).toBe(1);
    const after = out.store.rows.find((r) => r.id === line.id)!;
    expect(after.classification?.category).toBe("Food");
    expect(after.status).toBe("auto");

    const decided = { ...store, rows: store.rows.map((r) => ({ ...r, decision: { by: "user" as const, at: "x" } })) };
    expect(reclassifyWaiting(decided, book).changed).toBe(0);
  });
});

describe("credit card statements", () => {
  it("reads unmarked amounts as purchases and a payment as money in, so clear lines import on their own", async () => {
    const data = new TextEncoder().encode(
      [
        "Date,Transaction Details,Amount",
        "05/08/2026,KAI AS MANDAL Restaurants PUNE,70.00",
        "06/08/2026,MOR A TEA CENTER Restaurants PUNE,30.00",
        "10/08/2026,PAYMENT RECEIVED THANK YOU,500.00 Cr",
        "12/08/2026,RAJ AUTO Service Stations,1500.00",
      ].join("\n"),
    );
    const out = await processStatement(
      { data, filename: "card.csv", accountId: "account-credit", book, store: emptyImportStore(), categories, useAi: false },
      await env(),
    );
    const byText = (t: string) => out.rows.find((r) => r.rawDescription.includes(t))!;
    expect(byText("KAI AS MANDAL").direction).toBe("debit");
    expect(byText("KAI AS MANDAL").extractionConfidence).toBeGreaterThanOrEqual(0.6);
    expect(byText("KAI AS MANDAL").classification?.category).toBe("Food");
    expect(byText("KAI AS MANDAL").status).toBe("auto");
    expect(byText("PAYMENT RECEIVED").direction).toBe("credit");
    expect(byText("RAJ AUTO").classification?.category).toBe("Petrol");
  });
});

describe("a card statement chosen for a bank account", () => {
  it("is recognised and refused, so card purchases never show as money leaving the bank", async () => {
    const { looksLikeCardStatement } = await import("@/lib/statements/pipeline");
    expect(looksLikeCardStatement("94XXXXXXXXXX76.pdf")).toBe(true);
    expect(looksLikeCardStatement("statement.pdf", "Total Amount Due 13,776.11 Payment Due Date 15/09/2026")).toBe(true);
    expect(looksLikeCardStatement("8250712018_statement.pdf", "UPI/CRED/credit card bill payment")).toBe(false);

    const card = new TextEncoder().encode(["Date,Transaction Details,Amount", "05/08/2026,KAI AS MANDAL Restaurants PUNE,70.00"].join("\n"));
    await expect(
      processStatement({ data: card, filename: "94XXXXXXXXXX76.csv", accountId: "account-netbanking", book, store: emptyImportStore(), categories, useAi: false }, await env()),
    ).rejects.toMatchObject({ code: "unsupported_format" });
  });
});

describe("the bill payment on a card statement", () => {
  const cardCsv = (lines: string[]) => new TextEncoder().encode(["Date,Transaction Details,Amount", ...lines].join("\n"));
  const plan = { expenseCategories: DEFAULT_CATEGORIES, incomeCategories: DEFAULT_INCOME_CATEGORIES };

  it("is recorded as a payment from the bank to the card: not spending, not income; nothing else is changed", async () => {
    const { buildCommit } = await import("@/lib/statements/plan");
    const { deriveState } = await import("@/lib/finance/state");
    const { buildLedger } = await import("@/lib/finance/engine");
    const out = await processStatement(
      { data: cardCsv(["05/09/2026,PAYMENT RECEIVED THANK YOU,13776.11 Cr", "08/09/2026,MOR A TEA CENTER Restaurants,30.00"]), filename: "card.csv", accountId: "account-credit", book, store: emptyImportStore(), categories, useAi: false },
      await env(),
    );
    const payment = out.rows.find((r) => r.direction === "credit")!;
    expect(payment.classification).toMatchObject({ eventType: "TRANSFER", counterAccountId: "account-netbanking" });
    expect(payment.status).toBe("auto");

    const commit = buildCommit(book, out.record, out.rows, plan);
    if (!commit.ok) throw new Error(commit.failures.map((f) => f.message).join("; "));
    expect(commit.book.events.filter((e) => e.type === "transfer")).toHaveLength(1);
    expect(commit.book.events.filter((e) => e.type === "income")).toHaveLength(0);
    const st = deriveState(commit.book, buildLedger(commit.book), "2026-10-05");
    expect(st.accounts.find((a) => a.account.id === "account-credit")!.balanceMinor).toBe(-1_374_611); // paid 13,776.11, spent 30 on it
  });

  it("links to a payment already recorded from the bank as a card payment", async () => {
    const withTransfer: Book = {
      ...book,
      events: [{ id: "t1", type: "transfer", date: "2026-09-04", fromAccountId: "account-netbanking", toAccountId: "account-credit", amountMinor: 500_000, createdAt: "x", updatedAt: "x" }],
    };
    const out = await processStatement(
      { data: cardCsv(["05/09/2026,PAYMENT RECEIVED THANK YOU,5000.00 Cr"]), filename: "card2.csv", accountId: "account-credit", book: withTransfer, store: emptyImportStore(), categories, useAi: false },
      await env(),
    );
    expect(out.rows[0]).toMatchObject({ status: "matched_existing", eventId: "t1" });
  });
});

describe("a bank statement chosen for a credit card account", () => {
  it("is refused, so salary can never become 'paid the card'", async () => {
    const bank = new TextEncoder().encode(
      ["Date,Narration,Withdrawal,Deposit,Balance", "03/08/2026,NEFT CR-INVECTO TECHNOLOGIES PVT LTD-SALARY JUL,,58060.00,61938.27", "05/08/2026,UPI/KAI AS MANDAL Restaurants/YESB/1/Paid,70.00,,61868.27"].join("\n"),
    );
    await expect(
      processStatement({ data: bank, filename: "Account_XX2018.csv", accountId: "account-credit", book, store: emptyImportStore(), categories, useAi: false }, await env()),
    ).rejects.toMatchObject({ code: "unsupported_format" });
  });

  it("salary on a card statement is never taken for a bill payment", async () => {
    const { cardPaymentFor } = await import("@/lib/statements/card-payments");
    expect(cardPaymentFor({ direction: "credit", rawDescription: "Salary Invecto July", amountMinor: 5_806_000, transactionDate: "2026-08-03" }, "account-credit", book)).toBeNull();
    expect(cardPaymentFor({ direction: "credit", rawDescription: "Reimbursement Invecto June", amountMinor: 39_600, transactionDate: "2026-07-21" }, "account-credit", book)).toBeNull();
  });
});

describe("undoing an import", () => {
  it("removes what it created and unlinks what it only confirmed", async () => {
    const { removeImportEntries } = await import("@/lib/finance/book-ops");
    const src = (importId: string, role: "created" | "matched") => ({ kind: "statement" as const, importId, rowId: `${importId}-${role}`, filename: "f", line: 1, role });
    const b: Book = {
      ...book,
      events: [
        { id: "made", type: "expense", date: "2026-08-05", accountId: "account-credit", amountMinor: 7_000, categoryId: "food", createdAt: "x", updatedAt: "x", sources: [src("bad", "created")] },
        { id: "mine", type: "expense", date: "2026-08-06", accountId: "account-netbanking", amountMinor: 500, categoryId: "food", createdAt: "x", updatedAt: "x", sources: [src("good", "created"), src("bad", "matched")] },
        { id: "typed", type: "expense", date: "2026-08-07", accountId: "account-cash", amountMinor: 100, categoryId: "food", createdAt: "x", updatedAt: "x" },
      ],
    };
    const { book: after, removed } = removeImportEntries(b, "bad");
    expect(removed).toBe(1);
    expect(after.events.map((e) => e.id)).toEqual(["mine", "typed"]);
    expect(after.events[0].sources).toEqual([src("good", "created")]);
  });
});
