/** Everything this app keeps in the browser lives under keys starting with this. */
const PREFIX = "money-manager";
const FILES_DB = "money-manager-statement-files";

const appKeys = (): string[] => {
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k?.startsWith(PREFIX)) keys.push(k);
  }
  return keys;
};

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
 * stored statement PDFs. The page is reloaded afterwards so every screen starts empty.
 */
export async function resetEverything(): Promise<void> {
  for (const k of appKeys()) window.localStorage.removeItem(k);
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(FILES_DB);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
