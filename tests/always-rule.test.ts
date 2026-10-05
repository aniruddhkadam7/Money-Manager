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
