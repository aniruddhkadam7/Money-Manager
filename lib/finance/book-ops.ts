import { buildLedger } from "./engine";
import type { Account, AccountType, Book, EventDraft, EventIssue, EventSource, FinancialEvent, Person } from "./types";

/**
 * Pure, validated changes to a Book. Every change is applied to a copy and the
 * whole ledger is re-derived; if that would make any event fail that wasn't
 * already failing, the change is rejected and the original book is untouched.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; issues: EventIssue[] };

export interface Clock {
  now: () => string;
  newId: () => string;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
  newId: () => crypto.randomUUID(),
};

const keyOf = (i: EventIssue) => `${i.eventId}|${i.code}`;

/** Issues in `after` that were not already present in `before`. */
export function newIssues(before: Book, after: Book): EventIssue[] {
  const known = new Set(buildLedger(before).issues.map(keyOf));
  return buildLedger(after).issues.filter((i) => !known.has(keyOf(i)));
}

function accept(before: Book, after: Book): Result<Book> {
  const issues = newIssues(before, after);
  return issues.length === 0 ? { ok: true, value: after } : { ok: false, issues };
}

const invalid = (message: string, code = "invalid"): Result<never> => ({
  ok: false,
  issues: [{ eventId: "", code, message }],
});

/* ---------------- Events ---------------- */

export function addEvent(book: Book, draft: EventDraft, clock: Clock = systemClock): Result<Book> {
  const now = clock.now();
  const event = { ...draft, id: clock.newId(), createdAt: now, updatedAt: now } as FinancialEvent;
  return accept(book, { ...book, events: [...book.events, event] });
}

export function updateEvent(book: Book, id: string, draft: EventDraft, clock: Clock = systemClock): Result<Book> {
  const existing = book.events.find((e) => e.id === id);
  if (!existing) return invalid("That entry no longer exists.", "not_found");
  // Editing an entry doesn't change where it came from.
  const sources = existing.sources ? { sources: existing.sources } : {};
  const event = { ...draft, ...sources, id, createdAt: existing.createdAt, updatedAt: clock.now() } as FinancialEvent;
  return accept(book, { ...book, events: book.events.map((e) => (e.id === id ? event : e)) });
}

/** Puts a previously deleted entry back exactly as it was (used by Undo). */
export function restoreEvent(book: Book, event: FinancialEvent): Result<Book> {
  if (book.events.some((e) => e.id === event.id)) return invalid("That entry already exists.", "duplicate");
  return accept(book, { ...book, events: [...book.events, event] });
}

export function deleteEvent(book: Book, id: string): Result<Book> {
  if (!book.events.some((e) => e.id === id)) return invalid("That entry no longer exists.", "not_found");
  return accept(book, { ...book, events: book.events.filter((e) => e.id !== id) });
}

/** Records that a statement line confirms or created an entry. Metadata only: no money changes. */
export function linkSource(book: Book, eventId: string, source: EventSource): Result<Book> {
  const existing = book.events.find((e) => e.id === eventId);
  if (!existing) return invalid("That entry no longer exists.", "not_found");
  if (existing.sources?.some((s) => s.rowId === source.rowId)) return { ok: true, value: book };
  const next = { ...existing, sources: [...(existing.sources ?? []), source] } as FinancialEvent;
  return { ok: true, value: { ...book, events: book.events.map((e) => (e.id === eventId ? next : e)) } };
}

/* ---------------- Accounts ---------------- */

export interface AccountInput {
  name: string;
  type: AccountType;
  openingBalanceMinor: number;
  openedOn: string;
}

const cleanName = (name: string) => name.trim().replace(/\s+/g, " ");

export function addAccount(book: Book, input: AccountInput, clock: Clock = systemClock): Result<{ book: Book; account: Account }> {
  const name = cleanName(input.name);
  if (!name) return invalid("Give the account a name.");
  if (book.accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
    return invalid(`You already have an account called “${name}”.`, "duplicate_name");
  }
  const account: Account = {
    id: clock.newId(),
    name,
    type: input.type,
    openingBalanceMinor: input.openingBalanceMinor,
    openedOn: input.openedOn,
    createdAt: clock.now(),
  };
  const after = { ...book, accounts: [...book.accounts, account] };
  const r = accept(book, after);
  return r.ok ? { ok: true, value: { book: r.value, account } } : r;
}

export function updateAccount(
  book: Book,
  id: string,
  changes: Partial<Pick<Account, "name" | "openingBalanceMinor" | "openedOn">>,
): Result<Book> {
  const existing = book.accounts.find((a) => a.id === id);
  if (!existing) return invalid("That account no longer exists.", "not_found");
  const next = { ...existing, ...changes, name: changes.name === undefined ? existing.name : cleanName(changes.name) };
  if (!next.name) return invalid("Give the account a name.");
  if (book.accounts.some((a) => a.id !== id && a.name.toLowerCase() === next.name.toLowerCase())) {
    return invalid(`You already have an account called “${next.name}”.`, "duplicate_name");
  }
  return accept(book, { ...book, accounts: book.accounts.map((a) => (a.id === id ? next : a)) });
}

/** Every account an entry touches. */
export function accountIdsUsedBy(e: FinancialEvent): string[] {
  switch (e.type) {
    case "transfer":
      return [e.fromAccountId, e.toAccountId];
    case "invest":
      return [e.fromAccountId, e.holdingId];
    case "sell_investment":
      return [e.holdingId, e.toAccountId];
    case "update_valuation":
      return [e.holdingId];
    default:
      return [e.accountId];
  }
}

export type DeleteAccountChoice = { moveTo: string } | { withEntries: true };

/**
 * An account with history is only deleted when the person says what happens to its entries: move them
 * to another account (a transfer that would then go from an account to itself is dropped), or delete
 * them too. Either way the whole ledger is re-checked, as for any other change.
 */
export function deleteAccount(book: Book, id: string, choice?: DeleteAccountChoice): Result<Book> {
  const used = book.events.filter((e) => accountIdsUsedBy(e).includes(id));
  const accounts = book.accounts.filter((a) => a.id !== id);
  if (used.length === 0) return { ok: true, value: { ...book, accounts } };
  if (!choice) return invalid("This account has entries. Move them to another account, or delete them with it.", "in_use");

  if ("withEntries" in choice) {
    const gone = new Set(used.map((e) => e.id));
    return accept(book, { ...book, accounts, events: book.events.filter((e) => !gone.has(e.id)) });
  }

  const to = choice.moveTo;
  if (to === id || !book.accounts.some((a) => a.id === to)) return invalid("Pick another account to move the entries to.");
  const swap = (v: string) => (v === id ? to : v);
  const events = book.events
    .map((e) => {
      if (!used.includes(e)) return e;
      const next = { ...e } as Record<string, unknown>;
      for (const k of ["accountId", "fromAccountId", "toAccountId", "holdingId"]) if (typeof next[k] === "string") next[k] = swap(next[k] as string);
      return next as unknown as FinancialEvent;
    })
    .filter((e) => !(e.type === "transfer" && e.fromAccountId === e.toAccountId));
  return accept(book, { ...book, accounts, events });
}

/* ---------------- People ---------------- */

/** Finds a person by name (case-insensitive) or creates them. */
const nameWords = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Two names for the same person, as banks print them: equal, or one cut short ("Govindraj Ing" /
 * "Govindraj Ingle", "Malu Shivaji K" / "Malu Shivaji Ka"). The shorter must be at least 8 letters, have
 * two or more words, and every word must match the start of the other name's word in the same place.
 */
export function sameishName(a: string, b: string): boolean {
  const x = nameWords(a);
  const y = nameWords(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.replace(/\s/g, "").length < 8 || !long.startsWith(short)) return false;
  const sw = short.split(" ");
  const lw = long.split(" ");
  return sw.length >= 2 && sw.every((w, i) => lw[i]?.startsWith(w));
}

/** Pairs of people who look like one person under two spellings: [keep (the fuller name), merge in]. */
export function likelySamePeople(book: Book): [Person, Person][] {
  const out: [Person, Person][] = [];
  const people = [...book.people].sort((p, q) => q.name.length - p.name.length);
  const taken = new Set<string>();
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const [keep, drop] = [people[i], people[j]];
      if (taken.has(drop.id) || !sameishName(keep.name, drop.name)) continue;
      out.push([keep, drop]);
      taken.add(drop.id);
    }
  }
  return out;
}

/** Moves every entry of `dropId` onto `keepId` and removes `dropId`: one person, one running balance. */
export function mergePeople(book: Book, keepId: string, dropId: string): Result<Book> {
  if (keepId === dropId) return invalid("Pick two different people.");
  if (!book.people.some((p) => p.id === keepId) || !book.people.some((p) => p.id === dropId)) return invalid("That person no longer exists.", "not_found");
  const events = book.events.map((e) => {
    if (e.type === "split_expense") {
      if (!e.shares.some((s) => s.personId === dropId)) return e;
      // Both in one split: their shares become one.
      const merged = new Map<string, number>();
      for (const s of e.shares) {
        const id = s.personId === dropId ? keepId : s.personId;
        merged.set(id, (merged.get(id) ?? 0) + s.amountMinor);
      }
      return { ...e, shares: [...merged].map(([personId, amountMinor]) => ({ personId, amountMinor })) };
    }
    return "personId" in e && e.personId === dropId ? ({ ...e, personId: keepId } as FinancialEvent) : e;
  });
  return accept(book, { ...book, events, people: book.people.filter((p) => p.id !== dropId) });
}

export function ensurePerson(book: Book, name: string, clock: Clock = systemClock): { book: Book; person: Person } | null {
  const clean = cleanName(name);
  if (!clean) return null;
  const existing = book.people.find((p) => p.name.toLowerCase() === clean.toLowerCase());
  if (existing) return { book, person: existing };
  // The same person with the name cut short (or now printed in full): reuse them, keeping the fuller name.
  const alike = book.people.filter((p) => sameishName(p.name, clean));
  if (alike.length === 1) {
    const found = alike[0];
    if (clean.length <= found.name.length) return { book, person: found };
    const renamed = { ...found, name: clean };
    return { book: { ...book, people: book.people.map((p) => (p.id === found.id ? renamed : p)) }, person: renamed };
  }
  const person: Person = { id: clock.newId(), name: clean, createdAt: clock.now() };
  return { book: { ...book, people: [...book.people, person] }, person };
}

/** Every person an entry involves. */
export function personIdsUsedBy(e: FinancialEvent): string[] {
  switch (e.type) {
    case "split_expense":
      return e.shares.map((s) => s.personId);
    case "lend":
    case "borrow":
    case "repayment_received":
    case "repayment_made":
    case "reimbursable_expense":
      return [e.personId];
    default:
      return [];
  }
}

export function renamePerson(book: Book, id: string, name: string): Result<Book> {
  const clean = cleanName(name);
  if (!clean) return invalid("Enter a name.");
  if (!book.people.some((p) => p.id === id)) return invalid("That person no longer exists.", "not_found");
  if (book.people.some((p) => p.id !== id && p.name.toLowerCase() === clean.toLowerCase())) {
    return invalid(`You already have someone called “${clean}”.`, "duplicate_name");
  }
  return { ok: true, value: { ...book, people: book.people.map((p) => (p.id === id ? { ...p, name: clean } : p)) } };
}

/**
 * Takes back everything one statement import put in the book: entries it created are removed, and
 * entries it only confirmed lose its link. Used to redo an import made into the wrong account. Not
 * validated against the rest of the book on purpose: undoing must always be possible; anything left
 * inconsistent shows up as "not counted" for the person to see. Returns how many entries were removed.
 */
export function removeImportEntries(book: Book, importId: string): { book: Book; removed: number } {
  const created = (e: FinancialEvent) => e.sources?.some((s) => s.importId === importId && s.role === "created");
  const kept = book.events.filter((e) => !created(e));
  const events = kept.map((e) =>
    e.sources?.some((s) => s.importId === importId) ? ({ ...e, sources: e.sources.filter((s) => s.importId !== importId) } as FinancialEvent) : e,
  );
  return { book: { ...book, events }, removed: book.events.length - kept.length };
}

/** Someone with history can't be deleted: that would silently rewrite the past. */
export function deletePerson(book: Book, id: string): Result<Book> {
  if (book.events.some((e) => personIdsUsedBy(e).includes(id))) {
    return invalid("This person has entries. Delete or edit those first.", "in_use");
  }
  return { ok: true, value: { ...book, people: book.people.filter((p) => p.id !== id) } };
}

/** Finds an investment by name or creates it (empty, with no opening value). */
export function ensureInvestment(book: Book, name: string, today: string, clock: Clock = systemClock): { book: Book; account: Account } | null {
  const clean = cleanName(name);
  if (!clean) return null;
  const existing = book.accounts.find((a) => a.type === "investment" && a.name.toLowerCase() === clean.toLowerCase());
  if (existing) return { book, account: existing };
  const account: Account = {
    id: clock.newId(),
    name: clean,
    type: "investment",
    openingBalanceMinor: 0,
    openedOn: today,
    createdAt: clock.now(),
  };
  return { book: { ...book, accounts: [...book.accounts, account] }, account };
}

export const emptyBook = (): Book => ({ accounts: [], people: [], events: [] });
