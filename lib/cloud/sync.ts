import { supabase } from "./client";

/**
 * Keeps the app's localStorage entries mirrored in Supabase (table `kv`: one row per key, per user).
 *
 * The repositories keep reading and writing localStorage through `appStorage`; every write is also
 * queued for the cloud. On sign-in the cloud copy is pulled down first, so every device opens on the
 * same data. Keys still waiting to be uploaded are remembered across reloads and are never overwritten
 * by a pull, so an edit made offline isn't lost.
 */

const PREFIX = "money-manager";
const PENDING_KEY = "mm-sync:pending";
const REPLACED_PREFIX = "mm-sync:replaced:";
const PUSH_DELAY_MS = 300;

export type SyncStatus = "idle" | "saving" | "error";

let status: SyncStatus = "idle";
const listeners = new Set<(s: SyncStatus) => void>();
let active = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let pushing: Promise<void> | null = null;
/** Bumped on every write so a push only clears keys that didn't change while it was in flight. */
const versions = new Map<string, number>();

function setStatus(next: SyncStatus) {
  status = next;
  for (const l of listeners) l(next);
}

export function onSyncStatus(listener: (s: SyncStatus) => void): () => void {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

export function appKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k?.startsWith(PREFIX)) keys.push(k);
  }
  return keys;
}

function readPending(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function writePending(keys: Set<string>) {
  if (keys.size) window.localStorage.setItem(PENDING_KEY, JSON.stringify([...keys]));
  else window.localStorage.removeItem(PENDING_KEY);
}

function markPending(key: string) {
  versions.set(key, (versions.get(key) ?? 0) + 1);
  const pending = readPending();
  pending.add(key);
  writePending(pending);
  if (!active) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush().catch(() => undefined), PUSH_DELAY_MS);
}

/** localStorage for app data; writes also go to the cloud when signed in. */
export const appStorage = {
  getItem: (key: string): string | null => window.localStorage.getItem(key),
  setItem(key: string, value: string) {
    window.localStorage.setItem(key, value);
    markPending(key);
  },
  removeItem(key: string) {
    window.localStorage.removeItem(key);
    markPending(key);
  },
};

async function pushPending(): Promise<void> {
  const sb = supabase();
  const pending = readPending();
  if (!sb || !pending.size) return;
  const sent = new Map([...pending].map((k) => [k, versions.get(k) ?? 0]));
  const upserts: { key: string; value: string }[] = [];
  const deletes: string[] = [];
  for (const key of pending) {
    const value = window.localStorage.getItem(key);
    if (value === null) deletes.push(key);
    else upserts.push({ key, value });
  }
  if (upserts.length) {
    const { error } = await sb.from("kv").upsert(upserts.map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: "user_id,key" });
    if (error) throw error;
  }
  if (deletes.length) {
    const { error } = await sb.from("kv").delete().in("key", deletes);
    if (error) throw error;
  }
  const still = readPending();
  for (const [key, v] of sent) if ((versions.get(key) ?? 0) === v) still.delete(key);
  writePending(still);
}

/** Uploads everything still waiting. Rejects if the cloud can't be reached. */
export async function flush(): Promise<void> {
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

/**
 * Puts the cloud's value in place of this device's. A different local value is first kept under
 * `mm-sync:replaced:<key>` (outside the app's prefix, so it's never synced), so nothing is lost for good
 * if this browser held data the cloud never saw.
 */
function replaceLocal(key: string, value: string | null) {
  const local = window.localStorage.getItem(key);
  if (local === value) return;
  if (local !== null) {
    try {
      window.localStorage.setItem(`${REPLACED_PREFIX}${key}`, local);
    } catch {
      // Storage full: the cloud copy still wins.
    }
  }
  if (value === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, value);
}

/**
 * Called once after sign-in, before the app reads its data. Returns false when the cloud couldn't be
 * reached, in which case the app opens on this device's last copy and uploads once it can.
 */
export async function startSync(): Promise<boolean> {
  const sb = supabase();
  if (!sb) return true;
  active = true;
  try {
    await flush();
    const { data, error } = await sb.from("kv").select("key,value");
    if (error) throw error;
    const rows = data as { key: string; value: string }[];
    if (rows.length === 0) {
      // First sign-in: whatever this browser already holds becomes the cloud copy.
      const local = appKeys();
      if (local.length) {
        writePending(new Set([...readPending(), ...local]));
        await flush();
      }
      return true;
    }
    const pending = readPending();
    const inCloud = new Set(rows.map((r) => r.key));
    for (const r of rows) if (!pending.has(r.key)) replaceLocal(r.key, r.value);
    for (const k of appKeys()) if (!inCloud.has(k) && !pending.has(k)) replaceLocal(k, null);
    return true;
  } catch {
    setStatus("error");
    return false;
  }
}

/** Uploads what's waiting, then clears this device's copy. Throws (keeping the data) if the upload fails. */
export async function stopSync(): Promise<void> {
  await flush();
  active = false;
  for (const k of appKeys()) window.localStorage.removeItem(k);
  window.localStorage.removeItem(PENDING_KEY);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flush().catch(() => undefined));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush().catch(() => undefined);
  });
}
