import type { User } from "@supabase/supabase-js";
import { supabase } from "./client";

/**
 * The app lock: once signed in the session stays on the device, so a passcode keeps the app closed until
 * the passcode or the account password is entered. Both the passcode (only as a salted PBKDF2 hash) and
 * which way to unlock by default live in the account's user_metadata, so they follow the person to every
 * device. No passcode means no lock.
 */
export type UnlockMethod = "passcode" | "password";

export interface PasscodeRecord {
  salt: string;
  hash: string;
  length: 4 | 6;
  iterations: number;
}

export interface LockSettings {
  passcode?: PasscodeRecord;
  unlockWith: UnlockMethod;
}

/** The app locks again after being in the background this long. */
export const RELOCK_AFTER_MS = 2 * 60 * 1000;
/** Wrong passcodes in a row before only the password will do. */
export const MAX_PASSCODE_TRIES = 5;

const META_KEY = "app_lock";
// Not under the sync prefix: a count of wrong tries belongs to this device only.
const FAILS_KEY = "mm-lock:fails";
const ITERATIONS = 150_000;

export function lockSettings(user: User | null | undefined): LockSettings {
  const raw = (user?.user_metadata as Record<string, unknown> | undefined)?.[META_KEY] as Partial<LockSettings> | null | undefined;
  const p = raw?.passcode;
  const passcode = p && typeof p.salt === "string" && typeof p.hash === "string" && (p.length === 4 || p.length === 6) ? p : undefined;
  return { passcode, unlockWith: passcode && raw?.unlockWith !== "password" ? "passcode" : "password" };
}

const toHex = (bytes: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) => new Uint8Array(hex.match(/../g)?.map((h) => parseInt(h, 16)) ?? []);

async function derive(code: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256);
  return toHex(bits);
}

export async function checkPasscode(record: PasscodeRecord, code: string): Promise<boolean> {
  return (await derive(code, fromHex(record.salt), record.iterations)) === record.hash;
}

async function save(next: LockSettings): Promise<void> {
  const sb = supabase();
  if (!sb) throw new Error("Not signed in.");
  const { error } = await sb.auth.updateUser({ data: { [META_KEY]: next.passcode ? next : null } });
  if (error) throw new Error(error.message);
}

export async function setPasscode(current: LockSettings, code: string): Promise<void> {
  if (!/^(\d{4}|\d{6})$/.test(code)) throw new Error("The passcode must be 4 or 6 digits.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passcode: PasscodeRecord = { salt: toHex(salt), hash: await derive(code, salt, ITERATIONS), length: code.length as 4 | 6, iterations: ITERATIONS };
  // The first passcode becomes the default way in; changing it later keeps the person's choice.
  await save({ passcode, unlockWith: current.passcode ? current.unlockWith : "passcode" });
  resetFails();
}

export const removePasscode = (): Promise<void> => save({ unlockWith: "password" });

export const setUnlockWith = (current: LockSettings, unlockWith: UnlockMethod): Promise<void> => save({ ...current, unlockWith });

/** Checks the password by signing in again as the same account; the session it returns replaces the old one. */
export async function checkPassword(user: User, password: string): Promise<void> {
  const sb = supabase();
  if (!sb || !user.email) throw new Error("Not signed in.");
  const { error } = await sb.auth.signInWithPassword({ email: user.email, password });
  if (!error) return;
  if (/invalid login credentials/i.test(error.message)) throw new Error("Wrong password.");
  if (/rate limit|too many/i.test(error.message)) throw new Error("Too many attempts. Wait a minute and try again.");
  if (/load failed|failed to fetch|network|fetch/i.test(error.message)) throw new Error("Checking the password needs the internet. Connect and try again.");
  throw new Error(error.message);
}

export async function changePassword(user: User, currentPassword: string, newPassword: string): Promise<void> {
  if (newPassword.length < 8) throw new Error("Use at least 8 characters for the new password.");
  if (newPassword === currentPassword) throw new Error("The new password is the same as the current one.");
  await checkPassword(user, currentPassword).catch((e: Error) => {
    throw new Error(e.message === "Wrong password." ? "The current password is wrong." : e.message);
  });
  const { error } = await supabase()!.auth.updateUser({ password: newPassword });
  if (error) throw new Error(/weak|pwned|leaked/i.test(error.message) ? "That password is too easy to guess. Pick another." : error.message);
}

function read(): number {
  try {
    return Number(localStorage.getItem(FAILS_KEY)) || 0;
  } catch {
    return 0;
  }
}
function write(n: number) {
  try {
    if (n) localStorage.setItem(FAILS_KEY, String(n));
    else localStorage.removeItem(FAILS_KEY);
  } catch {
    /* private mode: the count just doesn't survive a reload */
  }
}
export const passcodeFails = read;
export const addPasscodeFail = (): number => {
  const n = read() + 1;
  write(n);
  return n;
};
export const resetFails = () => write(0);
