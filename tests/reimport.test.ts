import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from "@/lib/domain/categories";
import { defaultAccounts } from "@/lib/finance/migrate";
import type { Book } from "@/lib/finance/types";
import { acceptAllFlagged, markImported, processStatement, resolveRow, type PipelineEnv } from "@/lib/statements/pipeline";
import { buildCommit } from "@/lib/statements/plan";
import { emptyImportStore, type ImportStoreData } from "@/lib/statements/types";
import { expected, fixture, nodePdfjs } from "./pdf-helpers";

const ACCOUNT = "account-netbanking";
const plan = { expenseCategories: DEFAULT_CATEGORIES, incomeCategories: DEFAULT_INCOME_CATEGORIES };
let n = 0;
const env = async (): Promise<PipelineEnv> => ({ pdfjs: await nodePdfjs(), now: () => "2026-10-05T10:00:00Z", newId: () => `r${++n}` });

const startBook = (): Book => ({
  accounts: defaultAccounts("2026-01-01T00:00:00Z").map((a) => (a.id === ACCOUNT ? { ...a, openingBalanceMinor: expected.sept.opening, openedOn: "2026-08-01" } : a)),
  people: [],
  events: [],
});

const csvOf = () => {
  const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [
    "Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance",
    ...expected.sept.rows.map((r) => [dmy(r.date), q(r.narration), "", r.debit ? (r.debit / 100).toFixed(2) : "", r.credit ? (r.credit / 100).toFixed(2) : "", (r.balance / 100).toFixed(2)].join(",")),
    `Opening Balance,,,,,${(expected.sept.opening / 100).toFixed(2)}`,
  ];
  return new TextEncoder().encode(lines.join("\n"));
};

async function importFirst(book: Book) {
  const first = await processStatement({ data: fixture("hdfc_style.pdf"), filename: "hdfc_style.pdf", accountId: ACCOUNT, book, store: emptyImportStore(), categories: plan, useAi: false }, await env());
  let store: ImportStoreData = first.store;
  for (const r of first.rows.filter((x) => x.rawDescription.includes("RAHUL"))) {
    store = resolveRow(store, r.id, { kind: "classify", eventType: r.direction === "debit" ? "MONEY_LENT" : "LENDING_REPAYMENT", person: "Rahul Sharma" }, { book, now: "t" }).store;
  }
  store = acceptAllFlagged(store, first.record.id, { book, now: "t" }).store;
  const record = store.imports[0];
  const commit = buildCommit(book, record, store.rows.filter((r) => r.importId === record.id), plan);
  if (!commit.ok) throw new Error(commit.failures.map((f) => f.message).join("; "));
  return { book: commit.book, store: markImported(store, record.id, commit.outcomes, "t") };
}

describe("importing the same statement again must never duplicate entries", () => {
  it("recognises every line from the entries themselves, even if the import history is gone", async () => {
    const { book } = await importFirst(startBook());
    expect(book.events).toHaveLength(expected.sept.rows.length);
    expect(book.events.every((e) => e.sources?.[0]?.fingerprint)).toBe(true);
    expect(book.events.every((e) => e.sources?.[0]?.narration)).toBe(true);

    // Same lines, a different file (an Excel/CSV export), and no memory of the first import at all.
    const again = await processStatement({ data: csvOf(), filename: "export.csv", accountId: ACCOUNT, book, store: emptyImportStore(), categories: plan, useAi: false }, await env());
    expect(again.rows).toHaveLength(expected.sept.rows.length);
    expect(again.rows.every((r) => r.status === "already_imported")).toBe(true);
    expect(again.record.counts.alreadyImported).toBe(expected.sept.rows.length);

    const commit = buildCommit(book, again.record, again.rows, plan);
    expect(commit.ok && commit.outcomes.filter((o) => o.role === "created")).toHaveLength(0);
  });

  it("also works for entries imported before fingerprints were stored (legacy entries)", async () => {
    const { book } = await importFirst(startBook());
    const legacy: Book = { ...book, events: book.events.map((e) => ({ ...e, sources: e.sources?.map(({ fingerprint: _f, narration: _n, ...rest }) => rest) })) as Book["events"] };
    const again = await processStatement({ data: csvOf(), filename: "export.csv", accountId: ACCOUNT, book: legacy, store: emptyImportStore(), categories: plan, useAi: false }, await env());
    const dupes = again.rows.filter((r) => r.status === "already_imported").length;
    expect(dupes).toBeGreaterThanOrEqual(expected.sept.rows.length - 2);
    expect(again.rows.filter((r) => r.status === "auto" || r.status === "auto_flagged").length).toBeLessThanOrEqual(2);
  });

  it("keeps two genuinely separate identical purchases on the same day", async () => {
    // hdfc_style has two Swiggy ₹850 orders on 3 Sept with different references: both stay, both match one-to-one
    const { book } = await importFirst(startBook());
    const swiggy = book.events.filter((e) => e.description === "Swiggy");
    expect(swiggy).toHaveLength(2);
  });
});

describe("finding repeats that are already in the records", () => {
  it("flags the same statement lines recorded by two imports, but never two identical lines of one import", async () => {
    const { findImportedDuplicates } = await import("@/lib/finance/duplicates");
    const { book, store } = await importFirst(startBook());
    expect(findImportedDuplicates(book)).toEqual([]); // the two Swiggy ₹850 orders are from one import: both are real

    // A second import of the same lines now links to the existing entries instead of adding them again.
    const record = { ...store.imports[0], id: "second-import" };
    const rows = store.rows.map((r) => ({ ...r, id: `${r.id}-b`, importId: "second-import", status: "auto" as const }));
    const linked = buildCommit(book, record, rows, plan);
    if (!linked.ok) throw new Error(linked.failures.map((f) => f.message).join("; "));
    expect(linked.book.events.length).toBe(book.events.length);
    expect(linked.outcomes.every((o) => o.role === "matched")).toBe(true);

    // Repeats recorded before that check existed are still found: copy every statement entry under another import.
    const copies = book.events
      .filter((e) => e.sources?.some((s) => s.kind === "statement" && s.role === "created"))
      .map((e) => ({ ...e, id: `${e.id}-b`, sources: e.sources!.map((s) => ({ ...s, importId: "second-import" })) }));
    const twice = { book: { ...book, events: [...book.events, ...copies] as Book["events"] } };

    const groups = findImportedDuplicates(twice.book);
    const extras = groups.flatMap((g) => g.extras);
    expect(extras.length).toBe(twice.book.events.length - book.events.length);
    expect(extras.every((e) => e.sources!.some((s) => s.importId === "second-import"))).toBe(true);
    // the originals are the ones kept
    expect(groups.flatMap((g) => g.keep).every((e) => e.sources!.some((s) => s.importId !== "second-import"))).toBe(true);
  });
});
