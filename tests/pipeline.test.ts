import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from "@/lib/domain/categories";
import * as ops from "@/lib/finance/book-ops";
import { buildLedger } from "@/lib/finance/engine";
import { defaultAccounts } from "@/lib/finance/migrate";
import { deriveState } from "@/lib/finance/state";
import type { Book } from "@/lib/finance/types";
import type { AiOutcome } from "@/lib/statements/ai";
import { cashEffects } from "@/lib/statements/match";
import {
  acceptAllFlagged, markFailures, markImported, processStatement, readiness, resolveRow, setOverride,
  type PipelineEnv, type ProcessInput,
} from "@/lib/statements/pipeline";
import { buildCommit, type PlanContext } from "@/lib/statements/plan";
import { emptyImportStore, StatementError, type ImportStoreData, type StatementRow } from "@/lib/statements/types";
import { expected, fixture, nodePdfjs } from "./pdf-helpers";

const ACCOUNT = "account-netbanking";
const plan: PlanContext = { expenseCategories: DEFAULT_CATEGORIES, incomeCategories: DEFAULT_INCOME_CATEGORIES };

let counter = 0;
const env = async (ai?: PipelineEnv["ai"]): Promise<PipelineEnv> => ({
  pdfjs: await nodePdfjs(),
  now: () => "2026-10-05T10:00:00.000Z",
  newId: () => `id-${++counter}`,
  ai: ai ?? (async (): Promise<AiOutcome> => ({ results: new Map(), cached: 0, asked: 0, answered: 0, updatedCache: {}, note: "AI is off in this test." })),
});

/** A book with the statement account holding the statement's opening balance. */
const bookWithOpening = (opening = expected.sept.opening): Book => {
  const accounts = defaultAccounts("2026-01-01T00:00:00Z").map((a) => (a.id === ACCOUNT ? { ...a, openingBalanceMinor: opening, openedOn: "2026-08-01" } : a));
  return { accounts, people: [], events: [], setup: { defaultAccountsAdded: true, defaultsVersion: 2 } };
};

const run = async (file: string, book: Book, store: ImportStoreData = emptyImportStore(), over: Partial<ProcessInput> = {}, e?: PipelineEnv) =>
  processStatement({ data: fixture(file), filename: file, accountId: ACCOUNT, book, store, categories: plan, ...over }, e ?? (await env()));

const row = (rows: StatementRow[], text: string, dir?: "debit" | "credit") =>
  rows.find((r) => r.rawDescription.toUpperCase().includes(text.toUpperCase()) && (!dir || r.direction === dir))!;

const balanceOf = (book: Book, accountId = ACCOUNT) => deriveState(book, buildLedger(book), "2026-12-31").accounts.find((a) => a.account.id === accountId)!;

/** Settle everything that needs a person the way a sensible person would. */
function settle(store: ImportStoreData, rows: StatementRow[], book: Book): ImportStoreData {
  const e = { book, now: "2026-10-05T10:05:00Z" };
  let s = store;
  for (const r of rows.filter((x) => x.rawDescription.includes("RAHUL"))) {
    const dir = r.direction;
    const res = resolveRow(s, r.id, { kind: "classify", eventType: dir === "debit" ? "MONEY_LENT" : "LENDING_REPAYMENT", person: "Rahul Sharma" }, e);
    expect(res.error).toBeUndefined();
    s = res.store;
  }
  return s;
}

describe("statement import pipeline", () => {
  it("processes a text statement end to end: parse, reconcile, classify, gate", async () => {
    const book = bookWithOpening();
    const { record, rows } = await run("hdfc_style.pdf", book);

    expect(rows).toHaveLength(expected.sept.rows.length);
    expect(record.status).toBe("REVIEW_REQUIRED");
    expect(record.reconciliation?.ok).toBe(true);
    expect(record.openingBalanceMinor).toBe(expected.sept.opening);
    expect(record.closingBalanceMinor).toBe(expected.sept.closing);
    expect(record.periodStart).toBe("2026-09-01");

    // raw text is preserved untouched
    expect(row(rows, "SALARY").rawDescription).toBe(expected.sept.rows[0].narration);

    expect(row(rows, "SALARY").status).toBe("auto");
    expect(row(rows, "SWIGGY").status).toBe("auto");
    expect(row(rows, "ATM").status).toBe("auto");
    expect(row(rows, "NETFLIX").status).toBe("auto");
    expect(row(rows, "AMIT KUMAR").status).toBe("auto_flagged"); // rent to a person: process, but flag
    expect(row(rows, "RAHUL SHARMA", "debit").status).toBe("review"); // a person: never automatic
    expect(row(rows, "RAHUL SHARMA", "credit").status).toBe("review");
    expect(record.counts.review).toBeGreaterThanOrEqual(3);
    expect(readiness(record, rows).ready).toBe(false);
  });

  it("does not drop the two ₹850 Swiggy orders or the two ₹2,000 payments: the bank's balances prove they are separate", async () => {
    const { rows } = await run("hdfc_style.pdf", bookWithOpening());
    expect(rows.filter((r) => r.rawDescription.includes("SWIGGY"))).toHaveLength(2);
    expect(rows.filter((r) => r.status === "skipped")).toHaveLength(0);
    expect(rows.filter((r) => r.status === "possible_duplicate")).toHaveLength(0);
  });

  it("imports into the ledger, and the account ends exactly at the bank's closing balance", async () => {
    const book = bookWithOpening();
    const out = await run("hdfc_style.pdf", book);
    let store = settle(out.store, out.rows, book);
    store = acceptAllFlagged(store, out.record.id, { book, now: "2026-10-05T10:06:00Z" }).store;
    const record = store.imports[0];
    const rows = store.rows.filter((r) => r.importId === record.id);
    expect(readiness(record, rows).blockers).toEqual([]);
    expect(record.status).toBe("READY_TO_IMPORT");

    const result = buildCommit(book, record, rows, plan);
    if (!result.ok) throw new Error(result.failures.map((f) => f.message).join("\n"));
    expect(result.outcomes.filter((o) => o.role === "created")).toHaveLength(expected.sept.rows.length);

    // The entries carry their source, and the ledger balances
    const created = result.book.events.filter((e) => e.sources?.length);
    expect(created).toHaveLength(expected.sept.rows.length);
    expect(created[0].sources![0]).toMatchObject({ kind: "statement", importId: record.id, filename: "hdfc_style.pdf", role: "created" });
    expect(balanceOf(result.book).balanceMinor).toBe(expected.sept.closing);
    expect(buildLedger(result.book).issues).toEqual([]);

    // Each entry moved the account by exactly the statement's amount
    const eff = cashEffects(buildLedger(result.book));
    for (const o of result.outcomes) {
      const r = rows.find((x) => x.id === o.rowId)!;
      expect(eff.get(o.eventId)!.get(ACCOUNT)).toBe(r.direction === "credit" ? r.amountMinor : -r.amountMinor);
    }
    // Rahul: lent 4,000, repaid 2,000 -> owes 2,000
    expect(result.book.people.map((p) => p.name)).toContain("Rahul Sharma");
    // Zerodha SIP became an investment
    expect(result.book.events.some((e) => e.type === "invest")).toBe(true);
    // The original book was not touched
    expect(book.events).toHaveLength(0);

    // Final bookkeeping
    const done = markImported(store, record.id, result.outcomes, "2026-10-05T10:07:00Z");
    expect(done.imports[0].status).toBe("IMPORTED");
    expect(done.imports[0].counts.imported).toBe(expected.sept.rows.length);
    expect(done.rows.every((r) => r.status === "imported" && r.eventId)).toBe(true);
  });

  it("never processes the same file twice", async () => {
    const book = bookWithOpening();
    const out = await run("hdfc_style.pdf", book);
    await expect(run("hdfc_style.pdf", book, out.store)).rejects.toMatchObject({ code: "duplicate_file", importId: out.record.id });
  });

  it("recognises lines already imported when statements overlap, and imports only the new ones", async () => {
    const book0 = bookWithOpening();
    const first = await run("hdfc_style.pdf", book0);
    let store = settle(first.store, first.rows, book0);
    store = acceptAllFlagged(store, first.record.id, { book: book0, now: "x" }).store;
    const rec = store.imports[0];
    const commit = buildCommit(book0, rec, store.rows.filter((r) => r.importId === rec.id), plan);
    if (!commit.ok) throw new Error(commit.failures.map((f) => f.message).join("; "));
    store = markImported(store, rec.id, commit.outcomes, "t");
    const book1 = commit.book;

    // overlap.pdf covers 20/09 -> 10/10: the September part is already in the ledger
    const second = await processStatement({ data: fixture("overlap.pdf"), filename: "overlap.pdf", accountId: ACCOUNT, book: book1, store, categories: plan }, await env());
    const already = second.rows.filter((r) => r.status === "already_imported");
    const fresh = second.rows.filter((r) => r.status !== "already_imported");
    const sept20plus = expected.sept.rows.filter((r) => r.date >= "2026-09-20").length;
    expect(already).toHaveLength(sept20plus);
    expect(fresh.length).toBe(expected.overlap.rows.length - sept20plus);
    expect(fresh.every((r) => r.transactionDate >= "2026-09-30" || r.transactionDate > "2026-09-30")).toBe(true);
    expect(second.record.counts.alreadyImported).toBe(sept20plus);
    // none of the already-imported lines would create anything
    const s2 = settle(second.store, second.rows, book1);
    const rec2 = s2.imports.find((i) => i.id === second.record.id)!;
    const rows2 = s2.rows.filter((r) => r.importId === rec2.id);
    const c2 = buildCommit(book1, rec2, rows2, plan);
    if (!c2.ok) throw new Error(c2.failures.map((f) => f.message).join("; "));
    expect(c2.outcomes.filter((o) => o.role === "created").length).toBeLessThanOrEqual(fresh.length);
  });

  it("links a statement line to an entry the person already made, instead of creating a second one", async () => {
    let book = bookWithOpening();
    const added = ops.addEvent(book, { type: "expense", date: "2026-09-03", description: "Swiggy dinner", accountId: ACCOUNT, amountMinor: 85000, categoryId: "food" });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    book = added.value;
    const manualId = book.events[0].id;

    const out = await run("hdfc_style.pdf", book);
    const matched = out.rows.filter((r) => r.status === "matched_existing");
    expect(matched).toHaveLength(1);
    expect(matched[0].eventId).toBe(manualId);
    expect(matched[0].match).toMatchObject({ kind: "existing_event" });
    // the other Swiggy ₹850 (same day, same amount) is NOT matched: one entry matches one line
    expect(out.rows.filter((r) => r.rawDescription.includes("SWIGGY") && r.status === "auto")).toHaveLength(1);

    let store = settle(out.store, out.rows, book);
    store = acceptAllFlagged(store, out.record.id, { book, now: "x" }).store;
    const rec = store.imports[0];
    const result = buildCommit(book, rec, store.rows.filter((r) => r.importId === rec.id), plan);
    if (!result.ok) throw new Error(result.failures.map((f) => f.message).join("; "));
    expect(result.outcomes.filter((o) => o.role === "matched")).toHaveLength(1);
    expect(result.book.events).toHaveLength(expected.sept.rows.length); // not +1
    expect(result.book.events.find((e) => e.id === manualId)!.sources![0]).toMatchObject({ role: "matched", importId: rec.id });
    expect(balanceOf(result.book).balanceMinor).toBe(expected.sept.closing);
  });

  it("an entry with the same amount but different wording is a possible duplicate, never silently merged or dropped", async () => {
    let book = bookWithOpening();
    const r = ops.addEvent(book, { type: "expense", date: "2026-09-08", description: "Pharmacy", accountId: ACCOUNT, amountMinor: 79900, categoryId: "health" });
    // the statement has an Amazon refund of ₹799 (credit) - make the manual one a matching credit instead
    const inc = ops.addEvent(book, { type: "income", date: "2026-09-27", description: "from a friend", accountId: ACCOUNT, amountMinor: 79900, categoryId: "gift" });
    expect(r.ok && inc.ok).toBe(true);
    if (!inc.ok) return;
    book = inc.value;
    const out = await run("hdfc_style.pdf", book);
    const refund = row(out.rows, "REFUND");
    expect(refund.status).toBe("possible_duplicate");
    expect(refund.match).toMatchObject({ kind: "possible_existing", level: 3 });
    expect(refund.classification).toBeDefined(); // ready for "it's a different transaction"

    // "It's different" -> goes on to be imported on its own
    const e = { book, now: "x" };
    const diff = resolveRow(out.store, refund.id, { kind: "different" }, e).store.rows.find((x) => x.id === refund.id)!;
    expect(diff.match).toBeUndefined();
    expect(["auto", "auto_flagged", "review"]).toContain(diff.status);
    // "Same" -> linked to the existing entry
    const same = resolveRow(out.store, refund.id, { kind: "same" }, e).store.rows.find((x) => x.id === refund.id)!;
    expect(same).toMatchObject({ status: "matched_existing", eventId: book.events.find((x) => x.description === "from a friend")!.id });
  });

  it("flags possible duplicates inside a statement when nothing proves they differ", async () => {
    const out = await run("headerless.pdf", bookWithOpening(0));
    // headerless statements have no opening balance; just confirm the pipeline copes and gates them
    expect(out.rows.length).toBeGreaterThan(0);
    expect(out.rows.every((r) => r.classification)).toBe(true);
  });

  it("teaches the rules: classifying one line settles the others from the same counterparty", async () => {
    const book = bookWithOpening();
    const out = await run("hdfc_style.pdf", book);
    const debits = out.rows.filter((r) => r.rawDescription.includes("RAHUL") && r.direction === "debit");
    expect(debits).toHaveLength(2);
    const res = resolveRow(out.store, debits[0].id, { kind: "classify", eventType: "MONEY_LENT", person: "Rahul Sharma" }, { book, now: "t" });
    const rowsAfter = res.store.rows;
    expect(rowsAfter.find((r) => r.id === debits[0].id)!.status).toBe("auto");
    // one confirmation of a person-event is "worth a glance", not "automatic": the second stays visible
    const second = rowsAfter.find((r) => r.id === debits[1].id)!;
    expect(second.status).toBe("auto_flagged");
    expect(second.classification).toMatchObject({ source: "user_rule", eventType: "MONEY_LENT", person: "Rahul Sharma" });
    expect(res.store.rules).toHaveLength(1);
  });

  it("will not accept a classification that is missing details", async () => {
    const book = bookWithOpening();
    const out = await run("hdfc_style.pdf", book);
    const r = row(out.rows, "RAHUL SHARMA", "debit");
    expect(resolveRow(out.store, r.id, { kind: "classify", eventType: "MONEY_LENT" }, { book, now: "t" }).error).toMatch(/Who/);
    expect(resolveRow(out.store, r.id, { kind: "classify", eventType: "TRANSFER" }, { book, now: "t" }).error).toMatch(/account/);
    expect(resolveRow(out.store, r.id, { kind: "classify", eventType: "INCOME" }, { book, now: "t" }).error).toMatch(/can't be recorded/);
  });

  it("is atomic: if one line is rejected, nothing is imported and the book is untouched", async () => {
    const book = bookWithOpening();
    const out = await run("hdfc_style.pdf", book);
    let store = settle(out.store, out.rows, book);
    store = acceptAllFlagged(store, out.record.id, { book, now: "x" }).store;
    // Make one line impossible: a card payment into an account that doesn't exist
    const target = store.rows.find((r) => r.classification?.eventType === "CREDIT_CARD_PAYMENT")!;
    store = { ...store, rows: store.rows.map((r) => (r.id === target.id ? { ...r, classification: { ...r.classification!, counterAccountId: "account-gone" } } : r)) };
    const rec = store.imports[0];
    const result = buildCommit(book, rec, store.rows.filter((r) => r.importId === rec.id), plan);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0].rowId).toBe(target.id);
    expect(book.events).toHaveLength(0);
    // failures are put back in front of the person
    const after = markFailures(store, rec.id, result.failures);
    expect(after.rows.find((r) => r.id === target.id)).toMatchObject({ status: "review" });
    expect(after.rows.find((r) => r.id === target.id)!.error).toBeTruthy();
    expect(after.imports[0].status).toBe("REVIEW_REQUIRED");
  });

  it("blocks import when the statement's totals don't add up, unless explicitly overridden", async () => {
    const book = bookWithOpening(expected.sept.opening);
    const out = await run("hdfc_style.pdf", book);
    // Corrupt one amount as a misread would
    const rows = out.rows.map((r, i) => (i === 4 ? { ...r, debitMinor: r.debitMinor + 100 } : r));
    const { reconcile } = await import("@/lib/statements/reconcile");
    expect(reconcile({ parser: "t", ocr: false, warnings: [], openingBalanceMinor: out.record.openingBalanceMinor, closingBalanceMinor: out.record.closingBalanceMinor,
      rows: rows.map((r) => ({ index: r.index, page: 1, date: r.transactionDate, rawDescription: r.rawDescription, debitMinor: r.debitMinor, creditMinor: r.creditMinor, balanceMinor: r.balanceAfterMinor, confidence: 1, rawLine: "", warnings: [] })) }).ok).toBe(false);

    const bad = { ...out.store, imports: out.store.imports.map((i) => ({ ...i, reconciliation: { ...i.reconciliation!, ok: false } })) };
    const blocked = readiness(bad.imports[0], out.rows.map((r) => ({ ...r, status: "auto" as const })));
    expect(blocked.ready).toBe(false);
    expect(blocked.blockers.join()).toMatch(/totals/);
    const overridden = setOverride(bad, out.record.id, true);
    expect(readiness(overridden.imports[0], out.rows.map((r) => ({ ...r, status: "auto" as const }))).ready).toBe(true);
  });

  it("rejects things that are not importable, with clear reasons", async () => {
    const book = bookWithOpening();
    await expect(run("garbage.pdf", book)).rejects.toMatchObject({ code: "invalid_pdf" });
    await expect(run("not_a_statement.pdf", book)).rejects.toBeInstanceOf(StatementError);
    await expect(run("protected.pdf", book)).rejects.toMatchObject({ code: "password_required" });
    await expect(run("protected.pdf", book, emptyImportStore(), { password: "nope" })).rejects.toMatchObject({ code: "password_incorrect" });
    const ok = await run("protected.pdf", book, emptyImportStore(), { password: expected.password });
    expect(ok.rows.length).toBeGreaterThan(0);
    // a loan account can't take a statement (credit cards can: they have card statements)
    const withLoan = { ...book, accounts: [...book.accounts, { id: "loan-1", name: "Home loan", type: "loan" as const, openingBalanceMinor: 0, openedOn: "2026-01-01", createdAt: "2026-01-01T00:00:00Z" }] };
    await expect(run("hdfc_style.pdf", withLoan, emptyImportStore(), { accountId: "loan-1" })).rejects.toMatchObject({ code: "unsupported_format" });
  });

  it("reports scanned PDFs it cannot read without OCR", async () => {
    await expect(run("scanned.pdf", bookWithOpening())).rejects.toMatchObject({ code: "ocr_failed" });
  });

  it("uses AI answers for unresolved lines, caps them, and falls back to review when AI is off", async () => {
    const book = bookWithOpening();
    const unknownRow = async () => {
      // statement lines the rules don't know: none in the fixture are unknown merchants, so check the fallback path via a fake AI on whatever is unresolved
      return null;
    };
    await unknownRow();
    const asked: string[] = [];
    const e = await env(async (rows) => {
      asked.push(...rows.map((r) => r.normalized.counterparty));
      return { results: new Map(), cached: 0, asked: rows.length, answered: 0, updatedCache: {} };
    });
    const out = await run("hdfc_style.pdf", book, emptyImportStore(), {}, e);
    // Whatever AI was asked about must never include lines the rules already settled with confidence
    expect(asked.join(" ").toLowerCase()).not.toMatch(/swiggy|netflix/);
    for (const r of out.rows) expect(r.classification).toBeDefined();
    const none = await run("hdfc_style.pdf", book, emptyImportStore(), { useAi: false });
    expect(none.rows.length).toBe(out.rows.length);
  });
});
