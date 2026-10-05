import type { Book } from "./types";

/**
 * Where the Book lives. V0 keeps it in the browser; the engine is pure, so the
 * same Book can later be stored server-side by implementing this interface.
 */
export interface BookRepository {
  /** Null when nothing has been saved yet (first run or before migration). */
  load(): Promise<Book | null>;
  save(book: Book): Promise<void>;
}

const BOOK_KEY = "money-manager:v1:book";

export class LocalStorageBookRepository implements BookRepository {
  async load(): Promise<Book | null> {
    const raw = window.localStorage.getItem(BOOK_KEY);
    if (!raw) return null;
    // Saved data that can't be read must fail loudly: returning null here would
    // make the app treat it as a first run and overwrite the user's records.
    const parsed = JSON.parse(raw) as Partial<Book>;
    if (!Array.isArray(parsed.accounts) || !Array.isArray(parsed.people) || !Array.isArray(parsed.events)) {
      throw new Error("Saved financial data is unreadable");
    }
    return parsed as Book;
  }

  async save(book: Book): Promise<void> {
    window.localStorage.setItem(BOOK_KEY, JSON.stringify(book));
  }
}
