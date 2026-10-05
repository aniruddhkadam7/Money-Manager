/** The original statement PDFs, kept in this browser (IndexedDB) so a line can be shown in its source page. */
const DB = "money-manager-statement-files";
const STORE = "files";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, use: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = use(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const isPdfBytes = (data: Uint8Array) => data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46;

/** Best effort: a failure here only means "View in statement" isn't offered. */
export async function saveStatementFile(importId: string, data: Uint8Array): Promise<void> {
  try {
    if (typeof indexedDB === "undefined" || !isPdfBytes(data)) return;
    await run("readwrite", (s) => s.put(new Uint8Array(data), importId));
  } catch {
    /* ignore */
  }
}

export async function loadStatementFile(importId: string): Promise<Uint8Array | null> {
  try {
    if (typeof indexedDB === "undefined") return null;
    const v = await run<Uint8Array | undefined>("readonly", (s) => s.get(importId));
    return v ? new Uint8Array(v) : null;
  } catch {
    return null;
  }
}

export async function hasStatementFile(importId: string): Promise<boolean> {
  try {
    if (typeof indexedDB === "undefined") return false;
    return (await run<number>("readonly", (s) => s.count(importId))) > 0;
  } catch {
    return false;
  }
}

export async function deleteStatementFile(importId: string): Promise<void> {
  try {
    if (typeof indexedDB === "undefined") return;
    await run("readwrite", (s) => s.delete(importId));
  } catch {
    /* ignore */
  }
}
