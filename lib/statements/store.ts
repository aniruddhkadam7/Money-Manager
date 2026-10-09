import { DEFAULT_SETTINGS, emptyImportStore, type ImportStoreData } from "./types";
import { appStorage } from "@/lib/cloud/sync";

/** Where imports, their lines, learned rules and settings live. V0: this browser. */
export interface ImportRepository {
  load(): Promise<ImportStoreData>;
  save(data: ImportStoreData): Promise<void>;
}

const KEY = "money-manager:v1:imports";

export class LocalStorageImportRepository implements ImportRepository {
  async load(): Promise<ImportStoreData> {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptyImportStore();
    // Unreadable data must fail loudly rather than be silently replaced.
    const parsed = JSON.parse(raw) as Partial<ImportStoreData>;
    if (!Array.isArray(parsed.imports) || !Array.isArray(parsed.rows)) throw new Error("Saved import data is unreadable");
    return {
      ...emptyImportStore(),
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      rules: parsed.rules ?? [],
      aiCache: parsed.aiCache ?? {},
      accountByMask: parsed.accountByMask ?? {},
      version: 1,
    };
  }

  async save(data: ImportStoreData): Promise<void> {
    appStorage.setItem(KEY, JSON.stringify(data));
  }
}
