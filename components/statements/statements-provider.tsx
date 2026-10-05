"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { aiAvailable } from "@/lib/statements/ai";
import { browserOcr, browserOcrImage, loadPdfjs } from "@/lib/statements/browser";
import {
  acceptAllFlagged, discardImport, failedImport, markFailures, markImported, processStatement, readiness, resolveRow, setOverride,
  type Decision, type Progress, type Readiness,
} from "@/lib/statements/pipeline";
import { buildCommit, type CommitFailure } from "@/lib/statements/plan";
import { LocalStorageImportRepository, type ImportRepository } from "@/lib/statements/store";
import { emptyImportStore, StatementError, type ImportRecord, type ImportSettings, type ImportStoreData, type StatementRow } from "@/lib/statements/types";
import { useFinance } from "../finance-provider";
import { deleteStatementFile, saveStatementFile } from "@/lib/statements/files";

type Status = "loading" | "ready" | "error";

export type UploadResult =
  | { ok: true; importId: string }
  | { ok: false; code: StatementError["code"] | "unknown"; message: string; importId?: string };

export type CommitOutcomeResult =
  | { ok: true; created: number; matched: number }
  | { ok: false; message: string; failures: CommitFailure[] };

interface StatementsContextValue {
  status: Status;
  imports: ImportRecord[];
  settings: ImportSettings;
  /** Whether the server has an OpenAI key. null = not checked yet. */
  aiReady: boolean | null;
  saveError: string | null;
  rowsOf: (importId: string) => StatementRow[];
  readinessOf: (importId: string) => Readiness;
  upload: (p: { file: File; accountId: string; password?: string; useAi: boolean; onProgress: (p: Progress) => void }) => Promise<UploadResult>;
  resolve: (rowId: string, decision: Decision) => { ok: true; applied: number } | { ok: false; message: string };
  acceptAllFlagged: (importId: string) => void;
  setReconciliationOverride: (importId: string, override: boolean) => void;
  commit: (importId: string) => Promise<CommitOutcomeResult>;
  discard: (importId: string) => void;
  updateSettings: (changes: Partial<ImportSettings>) => void;
  suggestedAccountFor: (key: string) => string | undefined;
}

const Ctx = createContext<StatementsContextValue | null>(null);

const repo: ImportRepository = new LocalStorageImportRepository();

const nowISO = () => new Date().toISOString();

export function StatementsProvider({ children, repository = repo }: { children: ReactNode; repository?: ImportRepository }) {
  const finance = useFinance();
  const [store, setStore] = useState<ImportStoreData>(emptyImportStore());
  const [status, setStatus] = useState<Status>("loading");
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const storeRef = useRef(store);

  useEffect(() => {
    let cancelled = false;
    repository.load().then(
      (data) => {
        if (cancelled) return;
        storeRef.current = data;
        setStore(data);
        setStatus("ready");
      },
      () => !cancelled && setStatus("error"),
    );
    aiAvailable().then((ok) => !cancelled && setAiReady(ok));
    return () => {
      cancelled = true;
    };
  }, [repository]);

  /** Keeps memory and storage in step; reports (and keeps going) if the browser refuses to save. */
  const persist = useCallback(
    async (next: ImportStoreData): Promise<boolean> => {
      try {
        await repository.save(next);
        setSaveError(null);
        storeRef.current = next;
        setStore(next);
        return true;
      } catch {
        setSaveError("Couldn't save import progress in this browser (is storage full?).");
        return false;
      }
    },
    [repository],
  );

  // Synchronous variant for UI decisions: memory first, storage right after.
  const apply = useCallback(
    (next: ImportStoreData) => {
      storeRef.current = next;
      setStore(next);
      repository.save(next).then(
        () => setSaveError(null),
        () => setSaveError("Couldn't save import progress in this browser (is storage full?)."),
      );
    },
    [repository],
  );

  const value = useMemo<StatementsContextValue>(() => {
    const planCtx = () => ({ expenseCategories: finance.expenseCategories, incomeCategories: finance.incomeCategories });

    return {
      status,
      imports: store.imports,
      settings: store.settings,
      aiReady,
      saveError,
      rowsOf: (importId) => store.rows.filter((r) => r.importId === importId).sort((a, b) => a.index - b.index),
      readinessOf: (importId) => {
        const record = store.imports.find((i) => i.id === importId);
        return record ? readiness(record, store.rows.filter((r) => r.importId === importId)) : { ready: false, blockers: ["Not found"], canImportReady: false };
      },
      suggestedAccountFor: (key) => store.accountByMask[key],

      upload: async ({ file, accountId, password, useAi, onProgress }) => {
        let data: Uint8Array;
        try {
          data = new Uint8Array(await file.arrayBuffer());
        } catch {
          return { ok: false, code: "invalid_pdf", message: "That file couldn't be opened." };
        }
        try {
          const result = await processStatement(
            { data, filename: file.name, accountId, password, book: finance.getBook(), store: storeRef.current, categories: planCtx(), onProgress, useAi },
            { pdfjs: await loadPdfjs(), ocr: browserOcr, ocrImage: browserOcrImage, now: nowISO, newId: () => crypto.randomUUID() },
          );
          if (!(await persist(result.store))) return { ok: false, code: "unknown", message: "The statement was read, but this browser couldn't store it." };
          await saveStatementFile(result.record.id, data);
          return { ok: true, importId: result.record.id };
        } catch (err) {
          if (err instanceof StatementError) {
            // Uploading the same file again keeps a copy for the earlier import, so "View in statement" can open it.
            if (err.code === "duplicate_file" && err.importId) await saveStatementFile(err.importId, data);
            // Needs the person (password) or is a repeat: nothing to record. Anything else is kept in history as FAILED.
            if (err.code !== "password_required" && err.code !== "password_incorrect" && err.code !== "duplicate_file") {
              await persist(failedImport(storeRef.current, { id: crypto.randomUUID(), filename: file.name, data, accountId, error: err.message, now: nowISO() }));
            }
            return { ok: false, code: err.code, message: err.message, importId: err.importId };
          }
          return { ok: false, code: "unknown", message: "Something went wrong while reading this statement." };
        }
      },

      resolve: (rowId, decision) => {
        const res = resolveRow(storeRef.current, rowId, decision, { book: finance.getBook(), now: nowISO() });
        if (res.error) return { ok: false, message: res.error };
        apply(res.store);
        return { ok: true, applied: res.applied ?? 0 };
      },
      acceptAllFlagged: (importId) => apply(acceptAllFlagged(storeRef.current, importId, { book: finance.getBook(), now: nowISO() }).store),
      setReconciliationOverride: (importId, override) => apply(setOverride(storeRef.current, importId, override)),
      discard: (importId) => {
        void deleteStatementFile(importId);
        apply(discardImport(storeRef.current, importId));
      },
      updateSettings: (changes) => apply({ ...storeRef.current, settings: { ...storeRef.current.settings, ...changes } }),

      commit: async (importId) => {
        const current = storeRef.current;
        const record = current.imports.find((i) => i.id === importId);
        if (!record) return { ok: false, message: "That import no longer exists.", failures: [] };
        if (record.status === "IMPORTED") return { ok: false, message: "This statement was already imported.", failures: [] };
        const rows = current.rows.filter((r) => r.importId === importId);
        const gate = readiness(record, rows);
        if (!gate.canImportReady) return { ok: false, message: gate.blockers.join(". ") + ".", failures: [] };

        const previousBook = finance.getBook();
        const built = buildCommit(previousBook, record, rows, planCtx());
        if (!built.ok) {
          apply(markFailures(current, importId, built.failures));
          return { ok: false, message: "Some lines couldn't be added, so nothing was imported. They're back in your review list with the reason.", failures: built.failures };
        }

        // Entries first, then the import record. If the second save fails, the first is undone.
        const saved = await finance.commitBook(built.book);
        if (!saved.ok) return { ok: false, message: saved.message, failures: [] };
        const next = markImported(current, importId, built.outcomes, nowISO());
        if (!(await persist(next))) {
          await finance.commitBook(previousBook);
          return { ok: false, message: "Couldn't record the import in this browser, so it was rolled back. Nothing was changed.", failures: [] };
        }
        return { ok: true, created: built.outcomes.filter((o) => o.role === "created").length, matched: built.outcomes.filter((o) => o.role === "matched").length };
      },
    };
  }, [status, store, aiReady, saveError, finance, apply, persist]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStatements(): StatementsContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStatements must be used within StatementsProvider");
  return ctx;
}
