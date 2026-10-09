import { supabase } from "./client";

/**
 * Keeps the app's localStorage entries mirrored in Supabase (table `kv`: one row per key, per user).
 *
 * The repositories keep reading and writing localStorage through `appStorage`; every write is also
 * queued for the cloud. Each cloud row carries a version, and an upload only succeeds against the version
 * this device last saw, so a device holding an old copy can never overwrite newer changes made elsewhere.
 * When that happens the cloud copy wins and this device's value is kept aside under `mm-sync:replaced:`.
 *
 * Keys still waiting to be uploaded are remembered across reloads and are never overwritten by a pull,
 * so an edit made offline isn't lost.
 */

export const PREFIX = "money-manager";
const PENDING_KEY = "mm-sync:pending";
const VERSIONS_KEY = "mm-sync:versions";
export const REPLACED_PREFIX = "mm-sync:replaced:";
const PUSH_DELAY_MS = 300;

export type SyncStatus = "idle" | "saving" | "error";

export interface CloudRow {
  key: string;
  value: string;
  version: number;
}

/** The cloud side, as the sync needs it. Writes report false when the row's version has moved on. */
export interface CloudTable {
  list(): Promise<CloudRow[]>;
  listVersions(): Promise<Omit<CloudRow, "value">[]>;
  get(key: string): Promise<CloudRow | null>;
  insert(key: string, value: string): Promise<boolean>;
  update(key: string, value: string, base: number): Promise<boolean>;
  remove(key: string, base: number): Promise<boolean>;
}

export interface SyncDeps {
  storage: Storage;
  table: () => CloudTable | null;
  /** Called after a conflict or a newer cloud copy changed this device's data, so screens re-read it. */
  onExternalChange: () => void;
}

export function createSync({ storage, table, onExternalChange }: SyncDeps) {
  let status: SyncStatus = "idle";
  const listeners = new Set<(s: SyncStatus) => void>();
  let active = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pushing: Promise<void> | null = null;
  /** Bumped on every local write so a push only clears keys that didn't change while it was in flight. */
  const edits = new Map<string, number>();

  const setStatus = (next: SyncStatus) => {
    status = next;
    for (const l of listeners) l(next);
  };

  const appKeys = (): string[] => {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    return keys;
  };

  const readJson = <T>(key: string, fallback: T): T => {
    try {
      const raw = storage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const readPending = () => new Set(readJson<string[]>(PENDING_KEY, []));
  const writePending = (keys: Set<string>) => {
    if (keys.size) storage.setItem(PENDING_KEY, JSON.stringify([...keys]));
    else storage.removeItem(PENDING_KEY);
  };
  /** The cloud version of each key this device last saw. A key missing here was never in the cloud for us. */
  const readVersions = () => readJson<Record<string, number>>(VERSIONS_KEY, {});
  const writeVersions = (v: Record<string, number>) => storage.setItem(VERSIONS_KEY, JSON.stringify(v));

  /** Puts the cloud's value in place of this device's, first keeping a different local value aside. */
  const replaceLocal = (key: string, value: string | null) => {
    const local = storage.getItem(key);
    if (local === value) return;
    if (local !== null) {
      try {
        storage.setItem(`${REPLACED_PREFIX}${key}`, local);
      } catch {
        // Storage full: the cloud copy still wins.
      }
    }
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  };

  const markPending = (key: string) => {
    edits.set(key, (edits.get(key) ?? 0) + 1);
    const pending = readPending();
    pending.add(key);
    writePending(pending);
    if (!active) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush().catch(() => undefined), PUSH_DELAY_MS);
  };

  /** Sends one key. Returns false on a version conflict. */
  const pushKey = async (t: CloudTable, key: string, versions: Record<string, number>): Promise<boolean> => {
    const value = storage.getItem(key);
    const base = versions[key];
    if (value === null) {
      if (base === undefined) return true;
      if (await t.remove(key, base)) {
        delete versions[key];
        return true;
      }
      // Already gone in the cloud counts as done; a newer row there is a conflict.
      if ((await t.get(key)) === null) {
        delete versions[key];
        return true;
      }
      return false;
    }
    if (base === undefined ? await t.insert(key, value) : await t.update(key, value, base)) {
      versions[key] = base === undefined ? 1 : base + 1;
      return true;
    }
    return false;
  };

  const pushPending = async (): Promise<void> => {
    const t = table();
    const pending = readPending();
    if (!t || !pending.size) return;
    const sent = new Map([...pending].map((k) => [k, edits.get(k) ?? 0]));
    const versions = readVersions();
    const conflicts: string[] = [];
    try {
      for (const key of pending) if (!(await pushKey(t, key, versions))) conflicts.push(key);
    } finally {
      writeVersions(versions);
    }
    for (const key of conflicts) {
      const row = await t.get(key);
      replaceLocal(key, row?.value ?? null);
      if (row) versions[key] = row.version;
      else delete versions[key];
    }
    writeVersions(versions);
    const still = readPending();
    for (const [key, n] of sent) if ((edits.get(key) ?? 0) === n || conflicts.includes(key)) still.delete(key);
    writePending(still);
    if (conflicts.length) onExternalChange();
  };

  /** Uploads everything still waiting. Rejects if the cloud can't be reached. */
  async function flush(): Promise<void> {
    if (!active) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    while (pushing) await pushing.catch(() => undefined);
    setStatus("saving");
    pushing = pushPending();
    try {
      await pushing;
      // Keys written while this push was in flight have their own push scheduled.
      setStatus(readPending().size ? "saving" : "idle");
    } catch (err) {
      setStatus("error");
      throw err;
    } finally {
      pushing = null;
    }
  }

  /** Makes this device match the cloud, leaving keys that are still waiting to upload alone. */
  const pull = async (t: CloudTable): Promise<void> => {
    const rows = await t.list();
    const versions = readVersions();
    if (rows.length === 0 && Object.keys(versions).length === 0) {
      // This browser has never synced and the cloud is empty: its data becomes the cloud copy.
      const local = appKeys();
      if (local.length) {
        writePending(new Set([...readPending(), ...local]));
        await flush();
      }
      return;
    }
    const pending = readPending();
    const inCloud = new Set(rows.map((r) => r.key));
    for (const r of rows) {
      if (pending.has(r.key)) continue;
      replaceLocal(r.key, r.value);
      versions[r.key] = r.version;
    }
    for (const k of appKeys()) {
      if (inCloud.has(k) || pending.has(k)) continue;
      replaceLocal(k, null);
      delete versions[k];
    }
    for (const k of Object.keys(versions)) if (!inCloud.has(k) && !pending.has(k)) delete versions[k];
    writeVersions(versions);
  };

  return {
    appKeys,
    flush,

    onStatus(listener: (s: SyncStatus) => void): () => void {
      listeners.add(listener);
      listener(status);
      return () => listeners.delete(listener);
    },

    /** localStorage for app data; writes also go to the cloud when signed in. */
    storage: {
      getItem: (key: string): string | null => storage.getItem(key),
      setItem(key: string, value: string) {
        storage.setItem(key, value);
        markPending(key);
      },
      removeItem(key: string) {
        storage.removeItem(key);
        markPending(key);
      },
    },

    /**
     * Called once after sign-in, before the app reads its data. Returns false when the cloud couldn't be
     * reached, in which case the app opens on this device's last copy and uploads once it can.
     */
    async start(): Promise<boolean> {
      const t = table();
      if (!t) return true;
      active = true;
      try {
        await flush();
        await pull(t);
        return true;
      } catch {
        setStatus("error");
        return false;
      }
    },

    /** When the app comes back into view: if another device saved since, load its copy. */
    async refresh(): Promise<void> {
      const t = table();
      if (!active || !t) return;
      await flush();
      if (readPending().size) return;
      const known = readVersions();
      const remote = await t.listVersions();
      const changed =
        remote.length !== Object.keys(known).length || remote.some((r) => known[r.key] !== r.version);
      if (!changed) return;
      await pull(t);
      onExternalChange();
    },

    /** Uploads what's waiting, then clears this device's copy. Throws (keeping the data) if the upload fails. */
    async stop(): Promise<void> {
      await flush();
      active = false;
      for (const k of appKeys()) storage.removeItem(k);
      storage.removeItem(PENDING_KEY);
      storage.removeItem(VERSIONS_KEY);
    },
  };
}

/** Supabase `kv` table with version checks done in the WHERE clause, so they can't race. */
export function supabaseTable(): CloudTable | null {
  const sb = supabase();
  if (!sb) return null;
  const kv = () => sb.from("kv");
  const now = () => new Date().toISOString();
  return {
    async list() {
      const { data, error } = await kv().select("key,value,version");
      if (error) throw error;
      return data as CloudRow[];
    },
    async listVersions() {
      const { data, error } = await kv().select("key,version");
      if (error) throw error;
      return data as Omit<CloudRow, "value">[];
    },
    async get(key) {
      const { data, error } = await kv().select("key,value,version").eq("key", key).maybeSingle();
      if (error) throw error;
      return (data as CloudRow | null) ?? null;
    },
    async insert(key, value) {
      const { error } = await kv().insert({ key, value, version: 1, updated_at: now() });
      if (error?.code === "23505") return false; // another device created it first
      if (error) throw error;
      return true;
    },
    async update(key, value, base) {
      const { data, error } = await kv().update({ value, version: base + 1, updated_at: now() }).eq("key", key).eq("version", base).select("key");
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
    async remove(key, base) {
      const { data, error } = await kv().delete().eq("key", key).eq("version", base).select("key");
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
  };
}

const browser = typeof window !== "undefined";
const sync = browser
  ? createSync({
      storage: window.localStorage,
      table: supabaseTable,
      // The providers read storage once on mount; reloading is the simple, reliable way to re-read it.
      onExternalChange: () => window.location.reload(),
    })
  : null;

const noop = async () => undefined;
export const appKeys = (): string[] => sync?.appKeys() ?? [];
export const flush = (): Promise<void> => sync?.flush() ?? noop();
export const onSyncStatus = (l: (s: SyncStatus) => void): (() => void) => sync?.onStatus(l) ?? (() => undefined);
export const startSync = (): Promise<boolean> => sync?.start() ?? Promise.resolve(true);
export const stopSync = (): Promise<void> => sync?.stop() ?? noop();
export const appStorage = {
  getItem: (key: string): string | null => sync?.storage.getItem(key) ?? null,
  setItem: (key: string, value: string) => sync?.storage.setItem(key, value),
  removeItem: (key: string) => sync?.storage.removeItem(key),
};

if (sync) {
  let lastRefresh = 0;
  window.addEventListener("online", () => void sync.flush().catch(() => undefined));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void sync.flush().catch(() => undefined);
    } else if (Date.now() - lastRefresh > 15_000) {
      lastRefresh = Date.now();
      void sync.refresh().catch(() => undefined);
    }
  });
}
