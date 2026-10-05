import type { Category } from "@/lib/domain/types";
import { buildLedger } from "@/lib/finance/engine";
import type { Book } from "@/lib/finance/types";
import { classifyWithAi, type AiOptions, type AiOutcome } from "./ai";
import { detectDuplicatesWithinStatement } from "./dedupe";
import { fileHash } from "./fingerprint";
import { matchExistingEntries, matchPreviousImports } from "./match";
import { extractPdfText, type ExtractedPdf, type PdfjsLike } from "./pdf";
import { detectFormat, parseCsv, readWorkbook, tableToPages } from "./tabular";
import { missingInfo, type CommitOutcome, type PlanContext } from "./plan";
import { reconcile } from "./reconcile";
import { buildRows } from "./rows";
import { classifyByRules, applyUserRule, fallbackClassification, gate, learnRule, relationships, ruleKey, type RuleContext } from "./rules";
import { parseStatementItems } from "./table-parser";
import {
  PERSON_EVENTS,
  StatementError,
  type Classification,
  type ImportCounts,
  type ImportRecord,
  type ImportSettings,
  type ImportStatus,
  type ImportStoreData,
  type StatementEventType,
  type StatementRow,
  type TextItem,
} from "./types";

/* ---------------- Progress ---------------- */

export type Stage = "reading" | "ocr" | "parsing" | "checking" | "matching" | "classifying" | "ai" | "saving";
export interface Progress {
  stage: Stage;
  /** 0..1 for the whole run. */
  fraction: number;
  label: string;
}

const STAGE_LABEL: Record<Stage, string> = {
  reading: "Reading the file",
  ocr: "Reading scanned pages",
  parsing: "Finding transactions",
  checking: "Checking the totals",
  matching: "Looking for duplicates and existing entries",
  classifying: "Classifying",
  ai: "Asking AI about the unclear ones",
  saving: "Saving",
};

/* ---------------- Environment ---------------- */

export interface PipelineEnv {
  pdfjs: PdfjsLike;
  /** Reads scanned pages (browser: render to canvas + Tesseract). Returns the words found, per page number. */
  ocr?: (pdf: ExtractedPdf, onPage: (done: number, total: number) => void) => Promise<Map<number, TextItem[]>>;
  /** Reads a photo or screenshot of a statement (browser: Tesseract). */
  ocrImage?: (image: Uint8Array) => Promise<TextItem[]>;
  ai?: (rows: StatementRow[], opts: AiOptions) => Promise<AiOutcome>;
  now: () => string;
  newId: () => string;
}

export interface ProcessInput {
  data: Uint8Array;
  filename: string;
  accountId: string;
  password?: string;
  book: Book;
  store: ImportStoreData;
  categories: PlanContext;
  /** Call with progress; may be called often. */
  onProgress?: (p: Progress) => void;
  useAi?: boolean;
  signal?: AbortSignal;
}

export interface ProcessResult {
  record: ImportRecord;
  rows: StatementRow[];
  /** The store with this import added (and any earlier FAILED attempt at the same file removed). */
  store: ImportStoreData;
}

export const emptyCounts = (): ImportCounts => ({
  transactions: 0, imported: 0, matchedExisting: 0, alreadyImported: 0, duplicates: 0, possibleDuplicates: 0,
  auto: 0, autoFlagged: 0, review: 0, skipped: 0, errors: 0,
});

export function countsOf(rows: StatementRow[]): ImportCounts {
  const c = emptyCounts();
  c.transactions = rows.length;
  for (const r of rows) {
    switch (r.status) {
      case "imported": c.imported++; break;
      case "matched_existing": c.matchedExisting++; break;
      case "already_imported": c.alreadyImported++; break;
      case "possible_duplicate": c.possibleDuplicates++; break;
      case "auto": c.auto++; break;
      case "auto_flagged": c.autoFlagged++; break;
      case "review": c.review++; break;
      case "skipped": if (r.match?.kind === "in_statement_duplicate") c.duplicates++; else c.skipped++; break;
      case "failed": c.errors++; break;
    }
  }
  return c;
}

/** Rows the person still has to settle. */
export const needsDecision = (r: StatementRow) => r.status === "review" || r.status === "possible_duplicate";

export interface Readiness {
  ready: boolean;
  blockers: string[];
  /** Only undecided lines stand in the way, so the lines already settled can be imported now. */
  canImportReady: boolean;
}

export function readiness(record: ImportRecord, rows: StatementRow[]): Readiness {
  const blockers: string[] = [];
  const open = rows.filter(needsDecision).length;
  if (open > 0) blockers.push(`${open} ${open === 1 ? "line needs" : "lines need"} your decision`);
  if (record.reconciliation && !record.reconciliation.ok && !record.reconciliationOverride) {
    blockers.push(record.reconciliation.verifiable ? "The statement's totals don't add up" : "The statement's totals couldn't be verified");
  }
  if (rows.some((r) => r.status === "failed")) blockers.push("Some lines failed to import");
  const ready = blockers.length === 0;
  const onlyDecisions = open > 0 && blockers.length === 1;
  return { ready, blockers, canImportReady: ready || (onlyDecisions && rows.some((r) => r.status === "auto" || r.status === "auto_flagged")) };
}

/** The import's status follows from its rows and checks; IMPORTED and FAILED are final. */
export function statusFor(record: ImportRecord, rows: StatementRow[]): ImportStatus {
  if (record.status === "IMPORTED" || record.status === "FAILED") return record.status;
  return readiness(record, rows).ready ? "READY_TO_IMPORT" : "REVIEW_REQUIRED";
}

export function refreshRecord(record: ImportRecord, rows: StatementRow[]): ImportRecord {
  const next = { ...record, counts: countsOf(rows) };
  return { ...next, status: statusFor(next, rows) };
}

/* ---------------- Classification and gating ---------------- */

export function ruleContext(book: Book, store: Pick<ImportStoreData, "rules">): RuleContext {
  const ledger = buildLedger(book);
  const has = (id: string) => book.accounts.some((a) => a.id === id);
  return {
    userRules: store.rules,
    people: book.people,
    relationships: relationships(book, ledger),
    accountIds: {
      cash: has("account-cash") ? "account-cash" : book.accounts.find((a) => a.type === "cash")?.id,
      creditCard: has("account-credit") ? "account-credit" : book.accounts.find((a) => a.type === "credit_card")?.id,
      loan: book.accounts.find((a) => a.type === "loan")?.id,
    },
  };
}

const sameReading = (a: Classification, b: Classification) =>
  a.eventType === b.eventType && (a.eventType !== "EXPENSE" && a.eventType !== "INCOME" ? true : (a.category ?? "").toLowerCase() === (b.category ?? "").toLowerCase());

/**
 * A keyword rule and the AI read the same line. When they agree, the stronger of the two stands. When the AI
 * disagrees with words to back it, nobody guesses: the line goes to the person with both readings offered.
 * An AI answer without evidence never overrides a rule.
 */
export function combineOpinions(rule: Classification, ai: Classification, reviewThreshold: number): Classification {
  if (sameReading(rule, ai)) return { ...rule, confidence: Math.max(rule.confidence, ai.confidence), reason: `${rule.reason} The AI read it the same way.` };
  if (ai.confidence < reviewThreshold) return rule;
  return {
    ...rule,
    confidence: Math.min(rule.confidence, reviewThreshold - 0.01),
    reason: `Two readings: ${rule.reason} The AI thinks ${ai.eventType.toLowerCase().replace(/_/g, " ")}${ai.category ? ` · ${ai.category}` : ""}: ${ai.reason}`,
    alternatives: [ai.eventType, ...rule.alternatives.filter((t) => t !== ai.eventType)],
  };
}

/** Status a classified row earns. Anything unreadable, unsupported or missing details goes to review regardless of confidence. */
export function statusForClassification(row: StatementRow, c: Classification, book: Book, settings: ImportSettings): StatementRow["status"] {
  if (row.extractionConfidence < 0.6) return "review";
  if (missingInfo(row, c, book)) return "review";
  return gate(c, settings.autoThreshold, settings.reviewThreshold);
}

function describeReason(row: StatementRow, c: Classification, book: Book, settings: ImportSettings): string {
  const missing = missingInfo(row, c, book);
  if (missing) return missing;
  if (row.extractionConfidence < 0.6) return "This line was hard to read from the PDF. Check the amount and date.";
  return c.confidence < settings.reviewThreshold ? c.reason : "";
}
export { describeReason };

/* ---------------- Processing ---------------- */

const pageProgress = (done: number, total: number, from: number, to: number) => from + (to - from) * (total ? done / total : 1);

function sanityCheckAccount(book: Book, accountId: string) {
  const a = book.accounts.find((x) => x.id === accountId);
  if (!a) throw new StatementError("unsupported_format", "Choose which account this statement belongs to.");
  if (a.type !== "bank" && a.type !== "cash") {
    throw new StatementError("unsupported_format", `“${a.name}” is a ${a.type.replace("_", " ")}. Bank statements can be imported into bank or cash accounts.`);
  }
}

/** Turns any supported file into positioned text pages the parser understands. */
async function readPages(
  data: Uint8Array,
  filename: string,
  password: string | undefined,
  env: PipelineEnv,
  report: (stage: Stage, fraction: number, label?: string) => void,
  aborted: () => void,
): Promise<{ pages: TextItem[][]; usedOcr: boolean }> {
  const format = detectFormat(data, filename);

  if (format === "csv") return { pages: tableToPages(parseCsv(data)), usedOcr: false };
  if (format === "xlsx" || format === "xls") return { pages: tableToPages(await readWorkbook(data, password)), usedOcr: false };

  if (format === "image") {
    if (!env.ocrImage) throw new StatementError("ocr_failed", "Reading photos of statements isn't available here.");
    report("ocr", 0.1, "Reading the image");
    const items = await env.ocrImage(data);
    if (items.length === 0) throw new StatementError("ocr_failed", "No text could be read from this image. Try a sharper, upright picture.");
    return { pages: [items], usedOcr: true };
  }

  if (format !== "pdf") {
    throw new StatementError("unsupported_format", "This file type isn't supported. Upload the statement as a PDF, Excel (.xlsx/.xls), CSV, or a clear photo or screenshot (PNG/JPG).");
  }

  const extracted = await extractPdfText(data, env.pdfjs, password);
  aborted();
  let pages = extracted.pages;
  let usedOcr = false;
  try {
    if (extracted.scannedPages.length > 0) {
      if (!env.ocr) throw new StatementError("ocr_failed", "This looks like a scanned statement, and reading scans isn't available here.");
      report("ocr", 0.1);
      const read = await env.ocr(extracted, (done, total) => report("ocr", pageProgress(done, total, 0.1, 0.55), `Reading scanned pages (${done}/${total})`));
      pages = pages.map((items, i) => (extracted.scannedPages.includes(i + 1) ? read.get(i + 1) ?? [] : items));
      usedOcr = true;
    }
  } finally {
    await extracted.doc.destroy?.().catch(() => undefined);
  }
  aborted();
  return { pages, usedOcr };
}

export async function processStatement(input: ProcessInput, env: PipelineEnv): Promise<ProcessResult> {
  const { data, filename, accountId, book, categories } = input;
  const settings = input.store.settings;
  const report = (stage: Stage, fraction: number, label?: string) => input.onProgress?.({ stage, fraction, label: label ?? STAGE_LABEL[stage] });
  const aborted = () => {
    if (input.signal?.aborted) throw new StatementError("invalid_pdf", "Cancelled.");
  };

  sanityCheckAccount(book, accountId);

  // 1. Never process the same file twice.
  const hash = fileHash(data);
  const earlier = input.store.imports.find((i) => i.fileHash === hash && i.status !== "FAILED");
  if (earlier) {
    const when = new Date(earlier.uploadedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    throw new StatementError(
      "duplicate_file",
      earlier.status === "IMPORTED" ? `This exact file was already imported on ${when}.` : `This exact file was already uploaded on ${when} and is waiting for review.`,
      earlier.id,
    );
  }

  // 2. Read it, whatever it is.
  report("reading", 0.02);
  const { pages, usedOcr } = await readPages(data, filename, input.password, env, report, aborted);

  // 3. Find the transactions.
  report("parsing", 0.6);
  const parsed = parseStatementItems(pages, { ocr: usedOcr });
  if (parsed.rows.length === 0) {
    throw new StatementError(
      parsed.parser === "none" ? "unsupported_format" : "no_transactions",
      parsed.parser === "none"
        ? "This doesn't look like a bank statement with a transaction table. If it's a scan, make sure the pages are upright and clear."
        : "No transactions were found in this statement.",
    );
  }

  report("checking", 0.68);
  const reconciliation = reconcile(parsed);

  // 4. Rows, duplicates, matches.
  report("matching", 0.74);
  const importId = env.newId();
  const now = env.now();
  const rows = buildRows(parsed, { importId, accountId, newId: env.newId });
  detectDuplicatesWithinStatement(rows, parsed);
  const previous = input.store.rows.filter((r) => r.accountId === accountId && r.importId !== importId);
  matchPreviousImports(rows, previous);
  const ledger = buildLedger(book);
  const catName = (id: string) => [...categories.expenseCategories, ...categories.incomeCategories].find((c) => c.id === id)?.name ?? id;
  matchExistingEntries(rows, book, ledger, catName);
  for (const r of rows) if (r.decision?.at === "") r.decision.at = now;

  // 5. Classify what is left (possible duplicates too, so "it's different" has an answer ready).
  report("classifying", 0.82);
  const ctx = ruleContext(book, input.store);
  const open = rows.filter((r) => r.status === "pending" || r.status === "possible_duplicate");
  const unresolved: StatementRow[] = [];
  // Rule readings that aren't certain also get the AI's reading, as a second opinion.
  const secondOpinion: StatementRow[] = [];
  for (const r of open) {
    const c = classifyByRules(r, ctx);
    if (c) r.classification = c;
    if (!c || c.tentative) unresolved.push(r);
    else if (c.source === "rule" && c.confidence < settings.autoThreshold) secondOpinion.push(r);
  }

  let aiCache = input.store.aiCache;
  let aiUsed = false;
  let aiNote: string | undefined;
  const toAi = [...unresolved, ...secondOpinion];
  if (toAi.length > 0 && input.useAi !== false && settings.useAi) {
    report("ai", 0.88);
    const out = await (env.ai ?? classifyWithAi)(toAi, {
      expenseCategories: categories.expenseCategories.map((c) => c.name),
      incomeCategories: categories.incomeCategories.map((c) => c.name),
      cache: aiCache,
      now,
      signal: input.signal,
      allRows: rows,
    });
    aiCache = out.updatedCache;
    aiUsed = out.results.size > 0;
    aiNote = out.note;
    for (const r of unresolved) {
      const c = out.results.get(r.id);
      // A weak rule default gives way to any AI reading that is at least as sure; an unsure one stays a suggestion.
      if (c && (!r.classification?.tentative || c.confidence >= r.classification.confidence)) r.classification = c;
    }
    for (const r of secondOpinion) {
      const ai = out.results.get(r.id);
      if (ai && r.classification) r.classification = combineOpinions(r.classification, ai, settings.reviewThreshold);
    }
  } else if (unresolved.length > 0) {
    aiNote = input.useAi === false || !settings.useAi ? "AI classification was turned off." : undefined;
  }
  for (const r of unresolved) r.classification ??= fallbackClassification(r);

  // 6. Gate on confidence.
  for (const r of open) {
    if (r.status === "possible_duplicate") continue; // waits for the person; classification is ready for "it's different"
    r.status = statusForClassification(r, r.classification!, book, settings);
  }

  report("saving", 0.96);
  const period = rows.map((r) => r.transactionDate).sort();
  const record: ImportRecord = refreshRecord(
    {
      id: importId,
      filename,
      fileHash: hash,
      accountId,
      bankHint: parsed.bankHint,
      accountMask: parsed.accountMask,
      periodStart: parsed.periodStart ?? period[0],
      periodEnd: parsed.periodEnd ?? period[period.length - 1],
      uploadedAt: now,
      status: "PROCESSING",
      parser: parsed.parser,
      ocr: usedOcr,
      openingBalanceMinor: parsed.openingBalanceMinor,
      closingBalanceMinor: parsed.closingBalanceMinor,
      reconciliation,
      counts: emptyCounts(),
      aiUsed,
      aiNote,
    },
    rows,
  );

  const failedBefore = input.store.imports.filter((i) => i.fileHash === hash && i.status === "FAILED").map((i) => i.id);
  const store: ImportStoreData = {
    ...input.store,
    imports: [record, ...input.store.imports.filter((i) => !failedBefore.includes(i.id))],
    rows: [...input.store.rows.filter((r) => !failedBefore.includes(r.importId)), ...rows],
    aiCache,
    accountByMask: parsed.accountMask ? { ...input.store.accountByMask, [`${parsed.bankHint ?? ""}:${parsed.accountMask}`]: accountId } : input.store.accountByMask,
  };
  report("saving", 1, "Done");
  return { record, rows, store };
}

/** A FAILED record for history, so the person can see what was tried and why it didn't work. */
export function failedImport(store: ImportStoreData, p: { id: string; filename: string; data: Uint8Array; accountId: string; error: string; now: string }): ImportStoreData {
  const hash = fileHash(p.data);
  const record: ImportRecord = {
    id: p.id, filename: p.filename, fileHash: hash, accountId: p.accountId, uploadedAt: p.now, status: "FAILED",
    ocr: false, counts: emptyCounts(), aiUsed: false, error: p.error,
  };
  return { ...store, imports: [record, ...store.imports.filter((i) => !(i.fileHash === hash && i.status === "FAILED"))] };
}

/* ---------------- The person's decisions ---------------- */

export type Decision =
  | { kind: "classify"; eventType: StatementEventType; category?: string | null; person?: string | null; counterAccountId?: string | null; holding?: string | null; scope?: DecisionScope }
  /** Confirm the suggestion as it is. */
  | { kind: "accept"; scope?: DecisionScope }
  | { kind: "skip" }
  /** For a possible duplicate: yes, it's the same transaction. */
  | { kind: "same" }
  /** For a possible duplicate: no, it's a separate transaction. */
  | { kind: "different" }
  | { kind: "reopen" };

/**
 * How far an answer reaches. "always": this name is always this (remembered for good, applied to every
 * waiting line in every statement). "once": just this line, nothing learned. Unset: learned quietly.
 */
export type DecisionScope = "once" | "always";

export interface ResolveEnv {
  book: Book;
  now: string;
}

export interface ResolveResult {
  store: ImportStoreData;
  error?: string;
  /** Other waiting lines the answer was applied to. */
  applied?: number;
}

const userClassification = (base: Classification | undefined, d: Extract<Decision, { kind: "classify" }>): Classification => ({
  source: "user",
  eventType: d.eventType,
  category: d.category ?? null,
  merchant: base?.merchant ?? null,
  person: d.person ?? null,
  counterAccountId: d.counterAccountId ?? null,
  holding: d.holding ?? null,
  confidence: 1,
  reason: "You chose this.",
  alternatives: base?.alternatives ?? [],
});

/** Applies one decision to one row. Pure: returns a new store. */
export function resolveRow(store: ImportStoreData, rowId: string, decision: Decision, env: ResolveEnv): ResolveResult {
  const row = store.rows.find((r) => r.id === rowId);
  if (!row) return { store, error: "That line no longer exists." };
  const record = store.imports.find((i) => i.id === row.importId);
  if (!record || record.status === "IMPORTED") return { store, error: "This statement has already been imported." };

  let next: StatementRow = { ...row };
  let rules = store.rules;
  const by = { by: "user" as const, at: env.now };

  switch (decision.kind) {
    case "classify": {
      const c = userClassification(row.classification, decision);
      const missing = missingInfo(row, c, env.book);
      if (missing) return { store, error: missing };
      next = { ...next, classification: c, status: "auto", decision: by, error: undefined };
      if (decision.scope !== "once") rules = learnRule(rules, row, c, env.now, decision.scope === "always");
      break;
    }
    case "accept": {
      const base = row.classification;
      if (!base) return { store, error: "There's nothing to confirm yet." };
      const c: Classification = { ...base, source: "user", confidence: 1 };
      const missing = missingInfo(row, c, env.book);
      if (missing) return { store, error: missing };
      next = { ...next, classification: c, status: "auto", decision: by, error: undefined };
      if (decision.scope !== "once") rules = learnRule(rules, row, { ...base, source: "user" }, env.now, decision.scope === "always");
      break;
    }
    case "skip":
      next = { ...next, status: "skipped", decision: by };
      break;
    case "same":
      if (row.match?.eventId) next = { ...next, status: "matched_existing", eventId: row.match.eventId, decision: by };
      else next = { ...next, status: "skipped", decision: { ...by, note: "Same as another line in this statement" } };
      break;
    case "different": {
      const c = row.classification ?? fallbackClassification(row);
      const status = statusForClassification(row, c, env.book, store.settings);
      next = { ...next, match: undefined, eventId: undefined, classification: c, status, decision: by };
      break;
    }
    case "reopen":
      next = { ...next, status: row.match && row.match.level === 3 ? "possible_duplicate" : "review", eventId: row.match?.level === 3 ? undefined : undefined, decision: undefined };
      break;
  }

  let rows = store.rows.map((r) => (r.id === rowId ? next : r));
  let applied = 0;
  const always = (decision.kind === "classify" || decision.kind === "accept") && decision.scope === "always";
  const touched = new Set<string>([row.importId]);
  const open = new Set(store.imports.filter((i) => i.status !== "IMPORTED" && i.status !== "FAILED").map((i) => i.id));

  // What was just learned applies to the other lines that are still waiting: in this statement, or with
  // "always", in every open statement and also to lines the machine had already settled on its own.
  if (rules !== store.rules) {
    rows = rows.map((r) => {
      if (r.id === rowId || r.decision?.by === "user") return r;
      const inScope = always ? open.has(r.importId) && (r.status === "review" || r.status === "auto" || r.status === "auto_flagged") : r.importId === row.importId && r.status === "review" && !r.decision;
      if (!inScope || ruleKey(r) !== ruleKey(row) || r.direction !== row.direction) return r;
      const learned = applyUserRule(r, rules);
      if (!learned) return r;
      applied++;
      touched.add(r.importId);
      return { ...r, classification: learned, status: statusForClassification(r, learned, env.book, store.settings) };
    });
  }

  let nextStore: ImportStoreData = { ...store, rules };
  for (const id of touched) nextStore = commitRows(nextStore, id, rows);
  return { store: nextStore, applied };
}

/** Confirms every "worth a glance" line in one go (also teaches the rules). */
export function acceptAllFlagged(store: ImportStoreData, importId: string, env: ResolveEnv): ResolveResult {
  let current = store;
  for (const r of store.rows.filter((x) => x.importId === importId && x.status === "auto_flagged")) {
    const res = resolveRow(current, r.id, { kind: "accept" }, env);
    if (!res.error) current = res.store;
  }
  return { store: current };
}

function commitRows(store: ImportStoreData, importId: string, rows: StatementRow[]): ImportStoreData {
  const mine = rows.filter((r) => r.importId === importId);
  return {
    ...store,
    rows,
    imports: store.imports.map((i) => (i.id === importId ? refreshRecord(i, mine) : i)),
  };
}

export function setOverride(store: ImportStoreData, importId: string, override: boolean): ImportStoreData {
  return {
    ...store,
    imports: store.imports.map((i) => (i.id === importId ? refreshRecord({ ...i, reconciliationOverride: override }, store.rows.filter((r) => r.importId === importId)) : i)),
  };
}

/** Records the result of a successful commit on the import and its rows. */
export function markImported(store: ImportStoreData, importId: string, outcomes: CommitOutcome[], now: string): ImportStoreData {
  const byRow = new Map(outcomes.map((o) => [o.rowId, o]));
  const rows = store.rows.map((r) => {
    const o = byRow.get(r.id);
    if (!o || r.importId !== importId) return r;
    if (o.role === "created") return { ...r, status: "imported" as const, eventId: o.eventId };
    // A line that turned out to be already recorded from another statement is linked, not added.
    return { ...r, status: r.status === "auto" || r.status === "auto_flagged" ? ("matched_existing" as const) : r.status, eventId: o.eventId };
  });
  const mine = rows.filter((r) => r.importId === importId);
  // Lines still waiting for a decision keep the import open so they can be imported later.
  const open = mine.some(needsDecision);
  return {
    ...store,
    rows,
    imports: store.imports.map((i) =>
      i.id !== importId ? i : open ? refreshRecord(i, mine) : { ...i, status: "IMPORTED" as const, importedAt: now, counts: countsOf(mine) },
    ),
  };
}

/** Marks lines the ledger rejected so the person can fix them; the import stays open. */
export function markFailures(store: ImportStoreData, importId: string, failures: { rowId?: string; message: string }[]): ImportStoreData {
  const byRow = new Map(failures.filter((f) => f.rowId).map((f) => [f.rowId!, f.message]));
  const rows = store.rows.map((r) => {
    const message = byRow.get(r.id);
    if (message === undefined) return r;
    return { ...r, status: "review" as const, decision: undefined, error: message, };
  });
  return commitRows(store, importId, rows);
}

/** Throws away an import that hasn't been committed (its lines, and so the file can be uploaded again). */
export function discardImport(store: ImportStoreData, importId: string): ImportStoreData {
  const target = store.imports.find((i) => i.id === importId);
  if (!target || target.status === "IMPORTED") return store;
  return { ...store, imports: store.imports.filter((i) => i.id !== importId), rows: store.rows.filter((r) => r.importId !== importId) };
}

export type { Category };
