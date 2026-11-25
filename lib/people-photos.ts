import { useSyncExternalStore } from "react";
import { appStorage } from "@/lib/cloud/sync";

/**
 * People's pictures: small square JPEG data URLs (see cropPhoto). Each person's picture is its own key, so it's its
 * own row in the cloud (table `kv`, like all the app's data): it follows you to every device you sign in on, a
 * change uploads only that one picture, and two devices changing different people's pictures never clash.
 * Kept apart from the book so the book stays small (it's saved on every change and read by the advisor).
 */
const PHOTO_PREFIX = "money-manager:v1:person-photo:";
/** Before each picture had its own key: all of them in one. Moved over on first read. */
const OLD_KEY = "money-manager:v1:people-photos";
/** A person's picture is only ever shown small, so it's saved smaller than the profile photo (~8 KB). */
export const PERSON_PHOTO_SIZE = 160;

type Photos = Record<string, string>;
const listeners = new Set<() => void>();
let cached: Photos | null = null;
const EMPTY: Photos = {};

/** Pictures saved under the old single key get a key each (once; then the old key is removed, here and in the cloud). */
function moveOldPhotos() {
  const raw = window.localStorage.getItem(OLD_KEY);
  if (raw === null) return;
  try {
    const old = JSON.parse(raw) as unknown;
    if (old && typeof old === "object") {
      for (const [id, photo] of Object.entries(old as Photos)) {
        if (typeof photo === "string" && window.localStorage.getItem(PHOTO_PREFIX + id) === null) appStorage.setItem(PHOTO_PREFIX + id, photo);
      }
    }
  } catch {
    // Unreadable: nothing to move.
  }
  appStorage.removeItem(OLD_KEY);
}

function read(): Photos {
  if (typeof window === "undefined") return EMPTY;
  if (cached) return cached;
  moveOldPhotos();
  const photos: Photos = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key?.startsWith(PHOTO_PREFIX)) continue;
    const photo = window.localStorage.getItem(key);
    if (photo) photos[key.slice(PHOTO_PREFIX.length)] = photo;
  }
  cached = photos;
  return photos;
}

function changed() {
  // Re-read on next use. (Pictures arriving from another device reload the app, which re-reads them too.)
  cached = null;
  for (const l of listeners) l();
}

/** Sets (or, with `undefined`, removes) a person's picture. */
export function setPersonPhoto(id: string, photo: string | undefined) {
  if (photo) appStorage.setItem(PHOTO_PREFIX + id, photo);
  else if (read()[id]) appStorage.removeItem(PHOTO_PREFIX + id);
  changed();
}

/** After two people are merged: the one kept takes the other's picture if they had none. */
export function mergePersonPhotos(keepId: string, dropId: string) {
  const photos = read();
  const dropped = photos[dropId];
  if (!dropped) return;
  if (!photos[keepId]) appStorage.setItem(PHOTO_PREFIX + keepId, dropped);
  appStorage.removeItem(PHOTO_PREFIX + dropId);
  changed();
}

export function usePeoplePhotos(): Photos {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => EMPTY,
  );
}

export function usePersonPhoto(id: string | undefined): string | undefined {
  const photos = usePeoplePhotos();
  return id ? photos[id] : undefined;
}
