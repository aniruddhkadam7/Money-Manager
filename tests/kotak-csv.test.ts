import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from "@/lib/domain/categories";
import { defaultAccounts } from "@/lib/finance/migrate";
import { processStatement, type PipelineEnv } from "@/lib/statements/pipeline";
import { emptyImportStore } from "@/lib/statements/types";
import { fixture, nodePdfjs } from "./pdf-helpers";

let n = 0;
const env = async (): Promise<PipelineEnv> => ({ pdfjs: await nodePdfjs(), now: () => "2026-10-05T10:00:00Z", newId: () => `k${++n}` });

describe("Kotak-style CSV: one Amount column with a separate Dr / Cr column, dates with times", () => {
  it("reads every line with the right direction, date and amount", async () => {
    const book = { accounts: defaultAccounts("2026-01-01T00:00:00Z"), people: [], events: [] };
    const out = await processStatement(
      { data: fixture("kotak_style.csv"), filename: "kotak_style.csv", accountId: "account-netbanking", book, store: emptyImportStore(), categories: { expenseCategories: DEFAULT_CATEGORIES, incomeCategories: DEFAULT_INCOME_CATEGORIES }, useAi: false },
      await env(),
    );
    const rows = [...out.rows].sort((a, b) => a.index - b.index);
    expect(rows).toHaveLength(7);
    const interest = rows.find((r) => r.rawDescription.startsWith("Int.Pd"))!;
    expect(interest.direction).toBe("credit");
    expect(interest.amountMinor).toBe(7_200);
    expect(interest.transactionDate).toBe("2026-10-01");
    const tea = rows.find((r) => r.rawDescription.includes("TEA STALL"))!;
    expect(tea.direction).toBe("debit");
    expect(tea.amountMinor).toBe(2_000);
    expect(rows.find((r) => r.rawDescription.includes("SALARY"))!.amountMinor).toBe(877_727);
    expect(out.record.reconciliation?.ok).toBe(true);
  });
});
