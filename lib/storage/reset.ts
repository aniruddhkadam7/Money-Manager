import { appKeys, appStorage, flush } from "@/lib/cloud/sync";

const FILES_DB = "money-manager-statement-files";

/** A JSON copy of everything stored, so a reset can be undone by hand if ever needed. */
export function exportBackup(): string {
  const data: Record<string, unknown> = {};
  for (const k of appKeys()) {
    const raw = window.localStorage.getItem(k);
    try {
      data[k] = raw === null ? null : JSON.parse(raw);
    } catch {
      data[k] = raw;
    }
  }
  return JSON.stringify({ exportedAt: new Date().toISOString(), data }, null, 2);
}

/**
 * Wipes the app from this browser: entries, accounts, people, categories, imports, learned rules and the
 * stored statement PDFs, here and in the cloud copy. The page is reloaded afterwards so every screen starts empty.
 */
export async function resetEverything(): Promise<void> {
  for (const k of appKeys()) appStorage.removeItem(k);
  // If the cloud can't be reached now, the deletions stay queued and are sent before the next pull.
  await flush().catch(() => undefined);
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(FILES_DB);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
