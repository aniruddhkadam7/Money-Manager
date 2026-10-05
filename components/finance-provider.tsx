"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_INCOME_CATEGORIES, FALLBACK_CATEGORY } from "@/lib/domain/categories";
import { formatDisplayDate, todayISO } from "@/lib/domain/dates";
import type { Category, ExpenseRepository } from "@/lib/domain/types";
import * as ops from "@/lib/finance/book-ops";
import type { AccountInput, Result } from "@/lib/finance/book-ops";
import type { BookRepository } from "@/lib/finance/book-storage";
import { makeDescriber, type Describer } from "@/lib/finance/describe";
import { buildLedger } from "@/lib/finance/engine";
import { bookFromLegacyExpenses, missingDefaultAccounts, restoreDefaultAccounts, withDefaultAccounts, withMoneyBackCategories } from "@/lib/finance/migrate";
import { deriveState, periodReport, type FinancialState, type PeriodReport } from "@/lib/finance/state";
import type { Account, Book, EventDraft, EventIssue, FinancialEvent, Ledger } from "@/lib/finance/types";

type Status = "loading" | "ready" | "error";

interface FinanceContextValue {
  status: Status;
  book: Book;
  ledger: Ledger;
  /** Everything as of today, derived from the events. Never stored, never editable. */
  state: FinancialState;
  today: string;
  describer: Describer;
  categories: Category[];
  expenseCategories: Category[];
  incomeCategories: Category[];
  getCategory: (id: string) => Category;
  issuesByEvent: Map<string, EventIssue[]>;
  report: (from: string, to: string) => PeriodReport;

  addEvent: (draft: EventDraft) => Result<string>;
  updateEvent: (id: string, draft: EventDraft) => Result<string>;
  deleteEvent: (id: string) => Result<null>;
  /** Puts a deleted entry back exactly as it was (Undo). */
  restoreEvent: (event: FinancialEvent) => Result<string>;
  renamePerson: (id: string, name: string) => Result<null>;
  deletePerson: (id: string) => Result<null>;
  /** Moves all of one person's entries onto another and removes the first. */
  mergePeople: (keepId: string, dropId: string) => Result<null>;
  /** How many entries use this category. */
  categoryUsage: (id: string) => number;
  renameCategory: (id: string, name: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  deleteCategory: (id: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Finds a person by name or creates them. */
  resolvePerson: (name: string) => string | null;
  /** Finds an investment by name or creates it. */
  resolveInvestment: (name: string) => string | null;
  addAccount: (input: AccountInput) => Result<Account>;
  /** Standard accounts (Cash, UPI...) that are currently missing. */
  missingStandardAccounts: Account[];
  /** Puts back any missing standard accounts. */
  restoreStandardAccounts: () => void;
  updateAccount: (id: string, changes: Partial<Pick<Account, "name" | "openingBalanceMinor" | "openedOn">>) => Result<null>;
  deleteAccount: (id: string, choice?: ops.DeleteAccountChoice) => Result<null>;
  addCategory: (name: string) => Promise<Category>;
  saveError: string | null;
  /** The latest book, read synchronously (state can lag a render behind). */
  getBook: () => Book;
  /**
   * Replaces the whole book (used by statement import, which has already validated every entry).
   * Waits for the save; if saving fails the previous book is put back and nothing changes.
   */
  commitBook: (next: Book) => Promise<{ ok: true } | { ok: false; message: string }>;
}

const FinanceContext = createContext<FinanceContextValue | null>(null);

const EMPTY_BOOK: Book = { accounts: [], people: [], events: [] };

/**
 * The single place UI state meets the finance engine. Every change is validated
 * against the whole history before it is kept; every number the UI shows is
 * re-derived from the events.
 */
export function FinanceProvider({
  bookRepository,
  categoryRepository,
  children,
}: {
  bookRepository: BookRepository;
  /** Holds expense categories and the pre-engine expense list (read once, for migration). */
  categoryRepository: ExpenseRepository;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<Status>("loading");
  const [book, setBook] = useState<Book>(EMPTY_BOOK);
  const [expenseCategories, setExpenseCategories] = useState<Category[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Mutations read the latest book synchronously (e.g. add a person, then an event using them).
  const bookRef = useRef<Book>(EMPTY_BOOK);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let loaded = await bookRepository.load();
        if (!loaded) {
          loaded = bookFromLegacyExpenses(await categoryRepository.listExpenses(), new Date().toISOString());
          await bookRepository.save(loaded);
        }
        const withStarters = withMoneyBackCategories(withDefaultAccounts(loaded, new Date().toISOString()));
        if (withStarters !== loaded) {
          loaded = withStarters;
          await bookRepository.save(loaded);
        }
        const categories = await categoryRepository.listCategories();
        if (cancelled) return;
        bookRef.current = loaded;
        setBook(loaded);
        setExpenseCategories(categories);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookRepository, categoryRepository]);

  const commit = useCallback(
    (next: Book) => {
      bookRef.current = next;
      setBook(next);
      bookRepository.save(next).then(
        () => setSaveError(null),
        () => setSaveError("Couldn't save your changes in this browser."),
      );
    },
    [bookRepository],
  );

  const ledger = useMemo(() => buildLedger(book), [book]);
  const today = todayISO();
  const state = useMemo(() => deriveState(book, ledger, today), [book, ledger, today]);

  const incomeCategories = DEFAULT_INCOME_CATEGORIES;
  const categories = useMemo(() => [...expenseCategories, ...incomeCategories], [expenseCategories, incomeCategories]);
  const getCategory = useCallback(
    (id: string) => categories.find((c) => c.id === id) ?? FALLBACK_CATEGORY,
    [categories],
  );
  const describer = useMemo(() => makeDescriber(book, (id) => getCategory(id).name), [book, getCategory]);

  const issuesByEvent = useMemo(() => {
    const map = new Map<string, EventIssue[]>();
    for (const issue of ledger.issues) map.set(issue.eventId, [...(map.get(issue.eventId) ?? []), issue]);
    return map;
  }, [ledger]);

  const report = useCallback((from: string, to: string) => periodReport(book, ledger, from, to), [book, ledger]);

  const value = useMemo<FinanceContextValue>(() => {
    // When a change would break a DIFFERENT entry, say which one so the reason makes sense.
    const explain = (issues: EventIssue[], selfId?: string): EventIssue[] =>
      issues.map((issue) => {
        const other = issue.eventId !== selfId ? bookRef.current.events.find((e) => e.id === issue.eventId) : undefined;
        if (!other) return issue;
        const label = `“${describer.title(other)}” on ${formatDisplayDate(other.date)}`;
        return { ...issue, message: `That would break ${label}. ${issue.message}` };
      });

    const apply = <T,>(r: Result<Book>, pick: (b: Book) => T, selfId?: string): Result<T> => {
      if (!r.ok) return { ok: false, issues: explain(r.issues, selfId) };
      commit(r.value);
      return { ok: true, value: pick(r.value) };
    };

    return {
      status,
      book,
      ledger,
      state,
      today,
      describer,
      categories,
      expenseCategories,
      incomeCategories,
      getCategory,
      issuesByEvent,
      report,
      saveError,
      getBook: () => bookRef.current,
      commitBook: async (next) => {
        const previous = bookRef.current;
        bookRef.current = next;
        setBook(next);
        try {
          await bookRepository.save(next);
          setSaveError(null);
          return { ok: true };
        } catch {
          bookRef.current = previous;
          setBook(previous);
          try {
            await bookRepository.save(previous);
          } catch {
            // already failing; the in-memory book is restored either way
          }
          return { ok: false, message: "Couldn't save to this browser (is storage full?). Nothing was changed." };
        }
      },

      addEvent: (draft) => apply(ops.addEvent(bookRef.current, draft), (b) => b.events[b.events.length - 1].id),
      updateEvent: (id, draft) => apply(ops.updateEvent(bookRef.current, id, draft), () => id, id),
      deleteEvent: (id) => apply(ops.deleteEvent(bookRef.current, id), () => null),
      restoreEvent: (event) => apply(ops.restoreEvent(bookRef.current, event), () => event.id, event.id),
      renamePerson: (id, name) => apply(ops.renamePerson(bookRef.current, id, name), () => null),
      deletePerson: (id) => apply(ops.deletePerson(bookRef.current, id), () => null),
      mergePeople: (keepId, dropId) => apply(ops.mergePeople(bookRef.current, keepId, dropId), () => null),
      categoryUsage: (id) => bookRef.current.events.filter((e) => "categoryId" in e && e.categoryId === id).length,
      renameCategory: async (id, name) => {
        try {
          const updated = await categoryRepository.renameCategory(id, name);
          setExpenseCategories((prev) => prev.map((c) => (c.id === id ? updated : c)));
          return { ok: true };
        } catch (err) {
          return { ok: false, message: err instanceof Error ? err.message : "Couldn't rename that category." };
        }
      },
      deleteCategory: async (id) => {
        const used = bookRef.current.events.filter((e) => "categoryId" in e && e.categoryId === id).length;
        if (used > 0) {
          return { ok: false, message: `${used} ${used === 1 ? "entry uses" : "entries use"} this category. Change those first.` };
        }
        try {
          await categoryRepository.deleteCategory(id);
          setExpenseCategories((prev) => prev.filter((c) => c.id !== id));
          return { ok: true };
        } catch (err) {
          return { ok: false, message: err instanceof Error ? err.message : "Couldn't delete that category." };
        }
      },

      resolvePerson: (name) => {
        const r = ops.ensurePerson(bookRef.current, name);
        if (!r) return null;
        if (r.book !== bookRef.current) commit(r.book);
        return r.person.id;
      },
      resolveInvestment: (name) => {
        const r = ops.ensureInvestment(bookRef.current, name, todayISO());
        if (!r) return null;
        if (r.book !== bookRef.current) commit(r.book);
        return r.account.id;
      },

      missingStandardAccounts: missingDefaultAccounts(book, ""),
      restoreStandardAccounts: () => {
        const next = restoreDefaultAccounts(bookRef.current, new Date().toISOString());
        if (next !== bookRef.current) commit(next);
      },
      addAccount: (input) => {
        const r = ops.addAccount(bookRef.current, input);
        if (!r.ok) return r;
        commit(r.value.book);
        return { ok: true, value: r.value.account };
      },
      updateAccount: (id, changes) => apply(ops.updateAccount(bookRef.current, id, changes), () => null),
      deleteAccount: (id, choice) => apply(ops.deleteAccount(bookRef.current, id, choice), () => null),

      addCategory: async (name) => {
        const created = await categoryRepository.addCategory(name);
        setExpenseCategories((prev) => (prev.some((c) => c.id === created.id) ? prev : [...prev, created]));
        return created;
      },
    };
  }, [
    status, book, ledger, state, today, describer, categories, expenseCategories, incomeCategories,
    getCategory, issuesByEvent, report, saveError, commit, categoryRepository,
  ]);

  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}

export function useFinance(): FinanceContextValue {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error("useFinance must be used within FinanceProvider");
  return ctx;
}
