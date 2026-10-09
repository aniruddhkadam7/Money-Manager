import { useSyncExternalStore } from "react";
import { appStorage } from "@/lib/cloud/sync";

/** What the user tells the app about themselves. Stored like the rest of the data, so it follows them to every device. */
export interface Profile {
  name?: string;
  /** A small square JPEG as a data URL (see cropPhoto), so it fits in the synced storage. */
  photo?: string;
  phone?: string;
  /** `YYYY-MM-DD`. */
  dateOfBirth?: string;
  city?: string;
  occupation?: string;
}

const PROFILE_KEY = "money-manager:v1:profile";
const listeners = new Set<() => void>();
let cached: { raw: string | null; profile: Profile } | null = null;

function read(): Profile {
  const raw = typeof window === "undefined" ? null : window.localStorage.getItem(PROFILE_KEY);
  if (cached?.raw === raw) return cached.profile;
  let profile: Profile = {};
  try {
    profile = raw ? (JSON.parse(raw) as Profile) : {};
  } catch {
    // An unreadable profile only loses the extra details; the app works without them.
  }
  cached = { raw, profile };
  return profile;
}

export function saveProfile(profile: Profile) {
  const clean = Object.fromEntries(Object.entries(profile).filter(([, v]) => typeof v === "string" && v.trim())) as Profile;
  appStorage.setItem(PROFILE_KEY, JSON.stringify(clean));
  for (const l of listeners) l();
}

const EMPTY: Profile = {};
export function useProfile(): Profile {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => EMPTY,
  );
}

/** Opens a picked file as an image. The caller revokes `url` when done with it. */
export function loadPhoto(file: File): Promise<{ img: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file isn't a picture this browser can open."));
    };
    img.src = url;
  });
}

/**
 * Where the picture sits in a square frame of side `frame` px: its center is `x`,`y` px from the frame's
 * center, scaled by `scale` and turned by `rotation` quarter turns.
 */
export interface PhotoCrop {
  frame: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

/** Draws what the frame shows into a small square JPEG (~20 KB), so a phone photo of several MB fits the synced storage. */
export function cropPhoto(img: HTMLImageElement, crop: PhotoCrop, size = 256): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingQuality = "high";
  ctx.translate(size / 2, size / 2);
  ctx.scale(size / crop.frame, size / crop.frame);
  ctx.translate(crop.x, crop.y);
  ctx.rotate((crop.rotation * Math.PI) / 2);
  ctx.scale(crop.scale, crop.scale);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return canvas.toDataURL("image/jpeg", 0.85);
}
