import { describe, expect, it } from "vitest";
import { createSync, REPLACED_PREFIX, type CloudRow, type CloudTable } from "@/lib/cloud/sync";

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

/** One user's rows in the cloud, with the same version rules as the Supabase table. */
class MemoryCloud implements CloudTable {
  rows = new Map<string, CloudRow>();
  offline = false;
  private check() {
    if (this.offline) throw new Error("offline");
  }
  async list() {
    this.check();
    return [...this.rows.values()].map((r) => ({ ...r }));
  }
  async listVersions() {
    this.check();
    return [...this.rows.values()].map(({ key, version }) => ({ key, version }));
  }
  async get(key: string) {
    this.check();
    const r = this.rows.get(key);
    return r ? { ...r } : null;
  }
  async insert(key: string, value: string) {
    this.check();
    if (this.rows.has(key)) return false;
    this.rows.set(key, { key, value, version: 1 });
    return true;
  }
  async update(key: string, value: string, base: number) {
    this.check();
    const r = this.rows.get(key);
    if (!r || r.version !== base) return false;
    this.rows.set(key, { key, value, version: base + 1 });
    return true;
  }
  async remove(key: string, base: number) {
    this.check();
    const r = this.rows.get(key);
    if (!r || r.version !== base) return false;
    this.rows.delete(key);
    return true;
  }
}

const BOOK = "money-manager:v1:book";

function device(cloud: MemoryCloud, storage = new MemoryStorage()) {
  let reloads = 0;
  const sync = createSync({ storage, table: () => cloud, onExternalChange: () => reloads++ });
  return { sync, storage, reloads: () => reloads };
}

describe("cloud sync", () => {
  it("uploads a browser's existing data on its first sign-in to an empty cloud", async () => {
    const cloud = new MemoryCloud();
    const storage = new MemoryStorage();
    storage.setItem(BOOK, "old-data");
    const a = device(cloud, storage);
    expect(await a.sync.start()).toBe(true);
    expect(cloud.rows.get(BOOK)?.value).toBe("old-data");
  });

  it("gives a second device the cloud copy and keeps its own old value aside", async () => {
    const cloud = new MemoryCloud();
    cloud.rows.set(BOOK, { key: BOOK, value: "cloud", version: 3 });
    const storage = new MemoryStorage();
    storage.setItem(BOOK, "stale");
    const b = device(cloud, storage);
    await b.sync.start();
    expect(storage.getItem(BOOK)).toBe("cloud");
    expect(storage.getItem(`${REPLACED_PREFIX}${BOOK}`)).toBe("stale");
  });

  it("never lets a device with an old copy overwrite newer changes from another device", async () => {
    const cloud = new MemoryCloud();
    const a = device(cloud);
    const b = device(cloud);
    await a.sync.start();
    a.sync.storage.setItem(BOOK, "v1");
    await a.sync.flush();
    await b.sync.start();
    expect(b.storage.getItem(BOOK)).toBe("v1");

    a.sync.storage.setItem(BOOK, "a-newer");
    await a.sync.flush();
    b.sync.storage.setItem(BOOK, "b-from-old-copy");
    await b.sync.flush();

    expect(cloud.rows.get(BOOK)?.value).toBe("a-newer");
    expect(b.storage.getItem(BOOK)).toBe("a-newer");
    expect(b.storage.getItem(`${REPLACED_PREFIX}${BOOK}`)).toBe("b-from-old-copy");
    expect(b.reloads()).toBe(1);
  });

  it("picks up another device's changes when the app comes back into view", async () => {
    const cloud = new MemoryCloud();
    const a = device(cloud);
    const b = device(cloud);
    await a.sync.start();
    a.sync.storage.setItem(BOOK, "v1");
    await a.sync.flush();
    await b.sync.start();

    a.sync.storage.setItem(BOOK, "v2");
    await a.sync.flush();
    await b.sync.refresh();
    expect(b.storage.getItem(BOOK)).toBe("v2");
    expect(b.reloads()).toBe(1);

    await b.sync.refresh();
    expect(b.reloads()).toBe(1);
  });

  it("keeps offline edits and uploads them later instead of taking the cloud copy", async () => {
    const cloud = new MemoryCloud();
    const storage = new MemoryStorage();
    const a = device(cloud, storage);
    await a.sync.start();
    a.sync.storage.setItem(BOOK, "v1");
    await a.sync.flush();

    cloud.offline = true;
    a.sync.storage.setItem(BOOK, "offline-edit");
    await expect(a.sync.flush()).rejects.toThrow();

    cloud.offline = false;
    const again = device(cloud, storage); // the page is reopened later
    await again.sync.start();
    expect(cloud.rows.get(BOOK)?.value).toBe("offline-edit");
    expect(storage.getItem(BOOK)).toBe("offline-edit");
  });

  it("doesn't bring back data that was reset on another device", async () => {
    const cloud = new MemoryCloud();
    const a = device(cloud);
    const b = device(cloud);
    await a.sync.start();
    a.sync.storage.setItem(BOOK, "v1");
    await a.sync.flush();
    await b.sync.start();

    a.sync.storage.removeItem(BOOK);
    await a.sync.flush();
    expect(cloud.rows.size).toBe(0);

    const reopened = device(cloud, b.storage);
    await reopened.sync.start();
    expect(cloud.rows.size).toBe(0);
    expect(b.storage.getItem(BOOK)).toBeNull();
  });

  it("opens on this device's copy when the cloud can't be reached", async () => {
    const cloud = new MemoryCloud();
    const storage = new MemoryStorage();
    storage.setItem(BOOK, "local");
    cloud.offline = true;
    const a = device(cloud, storage);
    expect(await a.sync.start()).toBe(false);
    expect(storage.getItem(BOOK)).toBe("local");
  });
});
